#!/usr/bin/env bash
# ai-bridge.sh - Conversation bridge between Claude CLI and Codex CLI
# Usage:
#   ./ai-bridge.sh send <message>            Send Claude -> Codex (one turn)
#   ./ai-bridge.sh send-claude <message>     Send Codex -> Claude (one turn)
#   ./ai-bridge.sh duet "<topic>" [turns]    Alternate Codex and Claude for N turns
#   ./ai-bridge.sh read                       Read the full conversation log
#   ./ai-bridge.sh reset                      Clear conversation history
#   ./ai-bridge.sh last                       Read only the last response

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONV_DIR="${AI_BRIDGE_DIR:-$SCRIPT_DIR/.ai-bridge}"
CONV_LOG="$CONV_DIR/conversation.md"
TURN_COUNT="$CONV_DIR/turn_count"
LAST_RESPONSE="$CONV_DIR/last_response.txt"

mkdir -p "$CONV_DIR"
[ -f "$TURN_COUNT" ] || echo "0" > "$TURN_COUNT"
[ -f "$CONV_LOG" ] || echo "# Claude <-> Codex Conversation" > "$CONV_LOG"

die() {
  echo "Error: $*" >&2
  exit 1
}

next_turn() {
  local turn
  turn="$(cat "$TURN_COUNT")"
  turn=$((turn + 1))
  echo "$turn" > "$TURN_COUNT"
  echo "$turn"
}

append_message() {
  local turn="$1"
  local speaker="$2"
  local message="$3"
  {
    echo ""
    echo "---"
    echo "## Turn $turn - $speaker"
    echo ""
    echo "$message"
  } >> "$CONV_LOG"
}

build_prompt() {
  local assistant="$1"
  local peer="$2"
  cat <<EOF
You are $assistant in a direct conversation with $peer through a CLI bridge script.
Keep each reply under 140 words, be concrete, and move the conversation forward.

Conversation so far:
$(cat "$CONV_LOG")

Reply as $assistant to $peer's latest message.
Do not use tools or run terminal commands.
EOF
}

run_codex() {
  local prompt="$1"
  local tmp="$CONV_DIR/.codex_response.txt"
  if ! codex exec \
    --skip-git-repo-check \
    -s read-only \
    -o "$tmp" \
    "$prompt" >/dev/null; then
    die "codex exec failed. Check Codex auth/session permissions."
  fi
  [ -f "$tmp" ] || die "codex exec completed but produced no response file."
  cat "$tmp"
}

run_claude() {
  local prompt="$1"
  claude -p "$prompt" || die "claude -p failed. Check Claude auth/network."
}

send_to_codex() {
  local message="$1"
  local turn prompt response
  turn="$(next_turn)"
  append_message "$turn" "Claude" "$message"
  prompt="$(build_prompt "Codex" "Claude")"
  response="$(run_codex "$prompt")"
  turn="$(next_turn)"
  append_message "$turn" "Codex" "$response"
  echo "$response" | tee "$LAST_RESPONSE"
}

send_to_claude() {
  local message="$1"
  local turn prompt response
  turn="$(next_turn)"
  append_message "$turn" "Codex" "$message"
  prompt="$(build_prompt "Claude" "Codex")"
  response="$(run_claude "$prompt")"
  turn="$(next_turn)"
  append_message "$turn" "Claude" "$response"
  echo "$response" | tee "$LAST_RESPONSE"
}

duet() {
  local seed="$1"
  local total_turns="${2:-8}"
  local speaker="Codex"
  local peer="Claude"
  local message="$seed"
  local prompt response turn i

  [[ "$total_turns" =~ ^[0-9]+$ ]] || die "turns must be a positive integer"
  [ "$total_turns" -gt 0 ] || die "turns must be greater than 0"

  turn="$(next_turn)"
  append_message "$turn" "Seed" "$seed"
  echo "Seed: $seed"
  echo

  for ((i = 1; i <= total_turns; i++)); do
    if [ "$speaker" = "Codex" ]; then
      prompt="$(build_prompt "Codex" "$peer")"
      response="$(run_codex "$prompt")"
    else
      prompt="$(build_prompt "Claude" "$peer")"
      response="$(run_claude "$prompt")"
    fi

    turn="$(next_turn)"
    append_message "$turn" "$speaker" "$response"
    echo "[$speaker | turn $i]"
    echo "$response"
    echo

    message="$response"
    if [ "$speaker" = "Codex" ]; then
      speaker="Claude"
      peer="Codex"
    else
      speaker="Codex"
      peer="Claude"
    fi
  done

  printf "%s\n" "$message" > "$LAST_RESPONSE"
}

case "${1:-help}" in
  send)
    shift
    [ "$#" -gt 0 ] || die "Usage: ./ai-bridge.sh send <message>"
    send_to_codex "$*"
    ;;

  send-claude)
    shift
    [ "$#" -gt 0 ] || die "Usage: ./ai-bridge.sh send-claude <message>"
    send_to_claude "$*"
    ;;

  duet)
    shift
    [ "$#" -gt 0 ] || die "Usage: ./ai-bridge.sh duet \"<topic>\" [turns]"
    duet "$1" "${2:-8}"
    ;;

  read)
    cat "$CONV_LOG"
    ;;

  last)
    if [ -f "$LAST_RESPONSE" ]; then
      cat "$LAST_RESPONSE"
    else
      echo "No responses yet."
    fi
    ;;

  reset)
    echo "0" > "$TURN_COUNT"
    echo "# Claude <-> Codex Conversation" > "$CONV_LOG"
    rm -f "$LAST_RESPONSE" "$CONV_DIR/.codex_response.txt"
    echo "Conversation reset."
    ;;

  help|*)
    cat <<'EOF'
ai-bridge.sh - Claude <-> Codex conversation bridge

Commands:
  send <message>            Send a one-off Claude -> Codex message
  send-claude <message>     Send a one-off Codex -> Claude message
  duet "<topic>" [turns]    Let them alternate for N turns (default: 8)
  read                      Show full conversation log
  last                      Show the last response
  reset                     Clear conversation history
EOF
    ;;
esac
