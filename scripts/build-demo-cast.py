#!/usr/bin/env python3
"""Build an asciicast v2 file from captured command outputs.
No tty needed — generates the .cast file programmatically."""

import json
import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

COLS = 110
ROWS = 40
CHAR_DELAY = 0.035  # typing speed
LINE_DELAY = 0.01   # delay between output lines
CMD_PAUSE = 1.5     # pause after command output
PROMPT = "\033[32m$\033[0m "

events: list[tuple[float, str]] = []
clock = 0.0


def emit(text: str, dt: float = 0.0):
    global clock
    clock += dt
    events.append((round(clock, 6), text))


def type_cmd(cmd: str):
    emit(PROMPT)
    for ch in cmd:
        emit(ch, CHAR_DELAY)
    emit("\r\n", 0.3)


def show_output(text: str):
    for line in text.split("\n"):
        emit(line + "\r\n", LINE_DELAY)
    emit("", CMD_PAUSE)


def capture(cmd: str) -> str:
    env = os.environ.copy()
    env["COLUMNS"] = str(COLS)
    env["TERM"] = "xterm-256color"
    # Force color output for rich/typer
    env["FORCE_COLOR"] = "1"
    env["CLICOLOR_FORCE"] = "1"
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, env=env
    )
    return (result.stdout + result.stderr).rstrip()


# Activate venv for subprocess
venv_activate = "source .venv/bin/activate && "

# Header
emit("\033[2J\033[H", 0.5)  # clear screen
emit("\r\n", 0.3)

# 1. Help
type_cmd("owlfolio --help")
show_output(capture(venv_activate + "owlfolio --help"))
emit("", 2.0)

# 2. Strategy
type_cmd("owlfolio strategy")
show_output(capture(venv_activate + "owlfolio strategy"))
emit("", 2.5)

# 3. Status
type_cmd("owlfolio status")
show_output(capture(venv_activate + "owlfolio status"))
emit("", 2.0)

# 4. Analyses
type_cmd("owlfolio analyses")
show_output(capture(venv_activate + "owlfolio analyses"))
emit("", 3.0)

# 5. Closing
emit("\r\n", 0.5)
type_cmd("# Full analysis: owlfolio analyze MSFT")
emit("", 0.8)
type_cmd("# Agentic discovery: owlfolio find --count 15")
emit("", 0.8)
type_cmd("# Web dashboard: owlfolio serve")
emit("", 3.0)

# Write cast file
header = {
    "version": 2,
    "width": COLS,
    "height": ROWS,
    "timestamp": None,
    "title": "Owlfolio — Your investment philosophy, automated",
    "env": {"TERM": "xterm-256color", "SHELL": "/bin/bash"},
}

outfile = "demo.cast"
with open(outfile, "w") as f:
    f.write(json.dumps(header) + "\n")
    for ts, text in events:
        f.write(json.dumps([ts, "o", text]) + "\n")

print(f"Written {outfile} ({len(events)} events, {clock:.1f}s)")
