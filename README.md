# Excalidraw Dice

Tampermonkey userscript for adding a collapsible dice roller panel to Excalidraw.

## Install

1. Open Tampermonkey.
2. Create a new script.
3. Paste the contents of `excalidraw-dice.user.js`.
4. Save the script and open `https://excalidraw.com/`.

The script injects fixed CDN versions of:

- `mathjs@11.8.2`
- `random-js@2.1.0`
- `@dice-roller/rpg-dice-roller@5.5.1`

## Behavior

- Bottom bar shows the current roll expression and result, plus a `Roll` button that rolls the current expression.
- Expanded panel uses dice-pool controls: click a die to add one, click `-` to remove one.
- The `+1` row adjusts the modifier, producing expressions like `d20+3` or `d20-1`.
- The modifier row sits next to `Reason for Roll`.
- The expanded panel shows your local roll history above the bottom-aligned expression input.
- The expression input remains available for advanced notation such as `4d6kh3`.
- The reason field uses `Reason for Roll` as placeholder text.
- Runs on `https://excalidraw.com/*`, `https://app.excalidraw.com/*`, and Excalidraw subdomains.
- Roll logs are written to a single Excalidraw text element marked with `customData.excalidrawDiceLog`.
- Player name comes from Excalidraw's current username, falling back to `Anonymous`.

Example log line:

```text
Alice Initiative d20+3 => 17
```

## Smoke Tests

- Roll `d20+3`; a `历史记录` text element should appear on the canvas.
- Roll again; the same text element should receive another line.
- Collapse the panel and press `Roll`; it should roll the current expression from the dice pool/input.
- Change the expression after rolling; the bottom bar should show the changed expression and hide the old result.
- The expanded history should show time/name, expression/result, and reason on separate lines.
- Changing the Excalidraw collaboration name should update the name used in new dice logs.
- Expand the panel and click `d20` twice; the expression should become `2d20`.
- Click `d20`, `d6`, and `+1` three times; the expression should become `d20+d6+3`.
- Type `4d6kh3` directly in the expression field; it should roll and log normally.
- Press `Ctrl+Z`; the latest canvas write should undo.
- Refresh the page and roll again; the script should rediscover the Excalidraw API.
- After more than 20 dice log entries, only the latest 20 entries should remain in the canvas log.

## Troubleshooting

- If no panel appears, check the actual page URL. The script includes both `excalidraw.com` and `app.excalidraw.com`.
- Open the browser console and look for `[excalidraw-dice] userscript boot` and `[excalidraw-dice] UI mounted`.
- If neither log appears, Tampermonkey did not run the script.
- If the logs appear but the panel does not, the UI may be hidden behind browser zoom/layout; search the DOM for `#excalidraw-dice-root`.
- If the panel appears but rolling says the dice library is unavailable, check whether Firefox or an extension blocked the three CDN scripts.

## Known Risk

This script uses Excalidraw's internal React runtime to find the editor API. It is not an official Excalidraw plugin API, so future Excalidraw frontend changes may require updating the scanner.
