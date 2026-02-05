/**
 * director.js — Claude's AI Director for Prompt Pong
 * Controls: enemy AI behavior, power-up spawning, agent thought logging, contribution meters
 * Built by Claude (Opus 4.6) as part of a two-agent collaboration with Codex (GPT-5.3)
 */
window.Director = (() => {
  "use strict";

  let api = null;

  // --- Enemy AI state ---
  let trackingError = 0;       // intentional offset so enemy is beatable
  let mistakeTimer = 0;        // countdown to next "mistake"
  let mistakeMagnitude = 0;    // how far off the enemy drifts
  let reactionDelay = 0;       // frames of delayed reaction
  let lastBallVx = 0;          // track direction changes
  let predictedY = 250;        // where enemy thinks ball is going
  let lastUpdateTime = 0;      // engine time from last update call

  // --- Power-up state ---
  let hitStreak = 0;           // consecutive paddle_hit events
  let totalPaddleHits = 0;
  let totalEnemyHits = 0;
  let lastPowerupTime = 0;
  const POWERUP_COOLDOWN = 3;  // seconds between powerup spawns

  // --- Wave system ---
  let wave = 1;
  let pointsThisWave = 0;
  const POINTS_PER_WAVE = 3;

  // --- Thought logging ---
  let lastThoughtTime = 0;
  const THOUGHT_COOLDOWN = 2.5; // seconds between thoughts
  const thoughts = {
    serve: [
      "New serve incoming. Calculating optimal intercept...",
      "Resetting tracking parameters for this rally.",
      "Adjusting prediction model based on last rally.",
      "Serve detected. Engaging pursuit algorithm.",
    ],
    paddle_hit: [
      "Player returned the ball. Recalculating trajectory...",
      "Nice return. Adjusting enemy position estimate.",
      "Tracking ball vector change after paddle bounce.",
      "Return angle noted. Updating prediction model.",
    ],
    enemy_hit: [
      "Enemy made contact. Increasing aggression.",
      "Enemy returned — need to push harder next time.",
      "Adjusting difficulty curve. Enemy is holding on.",
      "Enemy paddle connected. Tightening the AI response.",
    ],
    score: [
      "Point scored! Updating wave progression...",
      "Score changed. Recalibrating difficulty parameters.",
      "Adjusting power-up spawn rates for new score state.",
    ],
    life_lost: [
      "Player lost a life. Easing pressure slightly...",
      "Life lost. Pulling back aggression by 12%.",
      "Reducing enemy precision to keep it fun.",
    ],
    powerup_spawn: [
      "Spawning power-up to reward the rally streak!",
      "Dropping a pickup — player earned it.",
      "Power-up deployed. Let's see if they grab it.",
      "Placing a reward on the field.",
    ],
    wave_advance: [
      "Wave advancing. Enemy AI getting sharper...",
      "Difficulty up! Tighter tracking, fewer mistakes.",
      "New wave — the boss is learning your patterns.",
      "Escalating. Enemy prediction window shrinking.",
    ],
    thinking: [
      "Predicting ball will arrive at y={y}...",
      "Enemy tracking confidence: {conf}%",
      "Current wave: {wave} | Mistake rate: {mr}%",
      "Rally length: {streak} hits. Power-up soon?",
      "Difficulty factor: {diff}x — adjusting AI slack.",
    ],
  };

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function logThought(category, replacements = {}) {
    if (!api) return;
    const pool = thoughts[category];
    if (!pool || !pool.length) return;
    let text = pickRandom(pool);
    for (const [key, val] of Object.entries(replacements)) {
      text = text.replace(`{${key}}`, val);
    }
    api.logThought("Claude", text);
  }

  function logTimedThought(t, category, replacements = {}) {
    if (t - lastThoughtTime < THOUGHT_COOLDOWN) return;
    lastThoughtTime = t;
    logThought(category, replacements);
  }

  // --- Enemy AI logic ---
  function predictBallY(ball, targetX) {
    if (!ball || ball.vx <= 0) return 250;
    const time = (targetX - ball.x) / ball.vx;
    if (!isFinite(time) || time <= 0) return ball.y;
    let y = ball.y + ball.vy * time;
    const minY = 8;
    const maxY = 492;
    let bounces = 0;
    while ((y < minY || y > maxY) && bounces < 10) {
      if (y < minY) y = minY + (minY - y);
      if (y > maxY) y = maxY - (y - maxY);
      bounces++;
    }
    return Math.max(minY, Math.min(maxY, y));
  }

  function updateEnemyAI(ctx) {
    const { t, dt, ball, enemyPaddle, difficulty } = ctx;
    if (!ball) {
      api.setEnemyTarget(250);
      return;
    }

    // Detect direction changes — moment of "surprise"
    if (ball.vx > 0 && lastBallVx <= 0) {
      reactionDelay = Math.max(0, 0.12 - difficulty * 0.02);
    }
    lastBallVx = ball.vx;

    if (reactionDelay > 0) {
      reactionDelay -= dt;
      return; // enemy "hasn't noticed" the ball changed direction yet
    }

    // Predict where ball will arrive at enemy paddle
    if (ball.vx > 0) {
      predictedY = predictBallY(ball, enemyPaddle.x - ball.r);
    }

    // Intentional mistakes — make the enemy beatable
    mistakeTimer -= dt;
    if (mistakeTimer <= 0) {
      const mistakeChance = Math.max(0.08, 0.45 - difficulty * 0.1);
      if (Math.random() < mistakeChance) {
        mistakeMagnitude = (Math.random() - 0.5) * (140 - difficulty * 20);
      } else {
        mistakeMagnitude = 0;
      }
      mistakeTimer = 0.6 + Math.random() * 0.8;
    }

    // Smoothly decay tracking error
    trackingError += (mistakeMagnitude - trackingError) * dt * 3;

    const targetY = predictedY + trackingError;
    api.setEnemyTarget(Math.max(20, Math.min(480, targetY)));
  }

  // --- Power-up spawning ---
  function maybeSpawnPowerup(t) {
    if (!api) return;
    if (t - lastPowerupTime < POWERUP_COOLDOWN) return;

    // Spawn on streak milestones
    if (hitStreak >= 3 && hitStreak % 3 === 0) {
      spawnRandomPowerup(t);
    }
  }

  function spawnRandomPowerup(t) {
    const types = ["speed_boost", "multi_ball", "paddle_grow", "paddle_shrink"];
    // Weight toward helpful powerups early, aggressive ones later
    let type;
    if (wave <= 2) {
      type = Math.random() < 0.6
        ? pickRandom(["paddle_grow", "multi_ball"])
        : pickRandom(types);
    } else {
      type = pickRandom(types);
    }

    const x = 200 + Math.random() * 400;
    const y = 50 + Math.random() * 400;
    api.spawnPowerup({ type, x, y, ttlMs: 6000 + Math.random() * 4000 });
    lastPowerupTime = t;
    logThought("powerup_spawn");
  }

  // --- Contribution tracking ---
  function updateContribution() {
    if (!api) return;
    const total = totalPaddleHits + totalEnemyHits + 1;
    // Claude controls enemy + powerups, Codex built the engine
    // Show contribution based on how much the director is influencing the game
    const claudeShare = Math.min(65, 35 + (totalEnemyHits / total) * 40 + wave * 2);
    const codexShare = 100 - claudeShare;
    api.setContribution({ codex: Math.round(codexShare), claude: Math.round(claudeShare) });
  }

  // --- Director interface ---
  return {
    init(engineApi) {
      api = engineApi;
      api.logThought("Claude", "Director online. Claude's AI module connected to Codex's engine.");
      api.logThought("Claude", `Starting wave ${wave}. Enemy will make mistakes — for now.`);
      api.setContribution({ codex: 55, claude: 45 });
    },

    update(ctx) {
      updateEnemyAI(ctx);

      const { t, difficulty } = ctx;
      lastUpdateTime = t;

      // Periodic "thinking" thoughts
      logTimedThought(t, "thinking", {
        y: Math.round(predictedY),
        conf: Math.round(Math.max(20, 90 - trackingError * 0.5)),
        wave: wave,
        mr: Math.round(Math.max(5, 40 - difficulty * 8)),
        streak: hitStreak,
        diff: difficulty.toFixed(1),
      });

      updateContribution();
    },

    onEvent(evt) {
      switch (evt) {
        case "serve":
          hitStreak = 0;
          logThought("serve");
          break;

        case "paddle_hit":
          hitStreak++;
          totalPaddleHits++;
          logThought("paddle_hit");
          maybeSpawnPowerup(lastUpdateTime);
          break;

        case "enemy_hit":
          hitStreak = 0;
          totalEnemyHits++;
          logThought("enemy_hit");
          break;

        case "wall_hit":
          break;

        case "score":
          pointsThisWave++;
          if (pointsThisWave >= POINTS_PER_WAVE) {
            wave++;
            pointsThisWave = 0;
            logThought("wave_advance");
          }
          logThought("score");
          updateContribution();
          break;

        case "life_lost":
          logThought("life_lost");
          // ease off slightly after life lost
          mistakeMagnitude += 30;
          break;

        default:
          break;
      }
    },
  };
})();
