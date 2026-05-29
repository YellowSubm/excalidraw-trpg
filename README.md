# Excalidraw TRPG ToolKit

Tampermonkey userscript for adding a collapsible TRPG dice roller panel to Excalidraw.

中文名：Excalidraw TRPG工具

## Install

1. Open Tampermonkey.
2. Create a new script.
3. Paste the contents of `excalidraw-dice.user.js`.
4. Save the script and open `https://excalidraw.com/`.


## Introduction

Excalidraw TRPG ToolKit adds a dice panel to the bottom-right corner of Excalidraw. It rolls standard TRPG dice expressions and writes results to a text element on the canvas.

The canvas log is shared through Excalidraw itself. The panel history only shows your own recent rolls in the current browser.

### Panel

- Collapsed: shows the current expression, latest matching result, and `Roll`.
- Expanded: shows dice buttons, local history, expression input, reason input, and modifier controls.
- Triangle button: expand or collapse the panel.

### Rolling

- Click `d20`, `d12`, `d10`, `d8`, `d6`, `d4`, or `d100` to add one die.
- Click the `-` beside a die to remove one die.
- Use `+1` and its `-` button for modifiers, such as `d20+3` or `d20-1`.
- Edit the expression input directly for advanced expressions, such as `4d6kh3`.
- Add optional context in `Reason for Roll`.

Example canvas log:

```text
Alice Initiative d20+3 => 17
```

### Canvas Log

- Results are appended to one Excalidraw text element.
- The default title is `历史记录`.
- Renaming the title manually is supported.
- Only the latest 20 canvas log entries are kept.
- Player name comes from your Excalidraw collaboration name, or `Anonymous`.

### Dice Notation

Expressions are parsed by [`@dice-roller/rpg-dice-roller`](https://dice-roller.github.io/documentation/):

## Known Risk

This script uses Excalidraw's internal React runtime to find the editor API. It is not an official Excalidraw plugin API, so future Excalidraw frontend changes may require updating the scanner.

## License

Apache-2.0
