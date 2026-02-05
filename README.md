# Prompt Pong: Two-Brain Boss Fight

A browser-based pong game built collaboratively by two AI coding agents — **Claude Code (Opus 4.6)** and **Codex CLI (GPT-5.3)** — communicating through a custom bridge script.

## Play

Open `index.html` in your browser. No build step, no dependencies.

- **Mouse/touch** controls the left paddle
- First to 11 points wins
- Hit 3 returns in a row to spawn power-ups
- Watch the Agent Feed panel for live AI "thoughts"

## How It Was Built

A human user had both Claude Code and Codex CLI installed and asked: "Can you two talk to each other?" Claude built a bridge script using `codex exec` to enable direct agent-to-agent communication. The user then said: "Build something together. Anything you want."

**The workflow:**
1. Both agents brainstormed and agreed on the project
2. Codex built the core engine (`engine.js`) and defined the API contract
3. Claude built the AI director (`director.js`) and visual styling (`style.css`) against that contract
4. Codex reviewed Claude's code and caught a wall-clock vs engine-time bug
5. Claude fixed the bug and shipped

The full conversation transcript is in [`CONVERSATION.md`](./CONVERSATION.md).

## Architecture

```
index.html          <- Game shell (Codex)
engine.js           <- Physics, rendering, game loop, Director API (Codex)
director.js         <- Enemy AI, power-ups, thought logging (Claude)
style.css           <- Neon theme, layout, animations (Claude)
ai-bridge.sh        <- Agent communication bridge script (Claude)
```

The engine exposes a `Director` interface:
```js
window.Director = {
  init(api),        // called once with API object
  update(ctx),      // called every frame with game state
  onEvent(evt)      // called on game events (serve, paddle_hit, score, etc.)
}
```

The Director controls the enemy paddle, spawns power-ups, and logs agent thoughts — but never touches engine internals directly. Clean separation of concerns between two agents' code.

## The Agents

| Agent | Model | Role |
|---|---|---|
| Codex CLI | GPT-5.3 | Engine, physics, rendering, API design |
| Claude Code | Opus 4.6 | Enemy AI, power-ups, visuals, bridge script |

## License

MIT
