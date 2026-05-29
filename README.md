# Excalidraw TRPG ToolKit

Tampermonkey userscript for adding a TRPG dice roller panel to Excalidraw.

## Install

1. Open Tampermonkey.
2. Create a new script.
3. Paste the contents of `excalidraw-dice.user.js`.
4. Save the script and open `https://excalidraw.com/`.


## Introduction

Excalidraw TRPG ToolKit adds a dice panel to the bottom-right corner of Excalidraw. It rolls standard TRPG dice expressions and writes results to a text element on the canvas.

The canvas log is shared through Excalidraw itself. The panel history only shows your own recent rolls in the current browser.

### Quick Roll

The collapsed panel is for repeated rolls. It shows the current expression and the latest matching result. Use `Roll` to roll again without opening the panel.

The modifier control changes the bonus or penalty, such as `d20+3` or `d20-1`.

Use `Reason for Roll` for action context, such as `Initiative`, `Attack`, or `Stealth`.

### Edit Roll

Expand the panel to change the roll. Dice controls adjust the number of each die. The modifier control changes the bonus or penalty, such as `d20+3` or `d20-1`.

The expression input can also be edited directly for advanced notation, such as `4d6kh3`.

Example log:

```text
Alice Initiative d20+3 => 17
```

### History

Each roll is appended to a canvas text element. The default title is `历史记录`; you can rename it. Only the latest 20 canvas log entries are kept.

The expanded panel also shows your own recent rolls for quick reference. Other players' rolls appear in the shared canvas log.

Player name comes from your Excalidraw collaboration name, or `Anonymous`.

### Dice Notation

Expressions are parsed by [`@dice-roller/rpg-dice-roller`](https://dice-roller.github.io/documentation/):

## Known Risk

This script uses Excalidraw's internal React runtime to find the editor API. It is not an official Excalidraw plugin API, so future Excalidraw frontend changes may require updating the scanner.

## License

Apache-2.0
