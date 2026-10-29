# Estymator visual refresh

The brief is a playful mathematical and computing identity, keeping the existing form of the
participant, projector and host views. Polish copy should explain actions and state, without slogans.

## Design tokens

- Ink `#202656`: blue ink for text and the projector background.
- Cobalt `#3448DA`: primary actions, the approximation wordmark and numeric emphasis.
- Paper `#F0F3FF`: cool graph-paper ground, with white writing surfaces.
- Grid `#D5DCF2`: structure and input borders.
- Highlighter `#FFE176`: countdown and first-place emphasis.
- Pink `#F2ADD0`: secondary podium places and result bars.

Use locally bundled Bricolage Grotesque (400–800, optical sizing) throughout. Its expressive shapes
carry the playfulness; tabular numbers keep clocks and results stable. Code and exact audit IDs keep
the system monospace fallback. Include Latin Extended for Polish and retain the OFL license.

## Layout choices

Keep the existing aligned layout and routes. Participant content is a narrow, left-aligned working
sheet, with the timer opposite the actual question number. The host keeps its tables and tabs.
The projector is the same working sheet at room scale, with a blue field and yellow countdown.

```text
Participant                Projector                     Host
≈ estymator    account     ≈ estymator      connection    ≈ estymator       screen
                           Question n / total            Host dashboard
Question n / total  time   question text                 status + tabs
question text                    countdown               controls or tables
answer input               saved / participants          filters + audit
save status
```

## Critique before implementation

A generic colorful card kit would preserve the current problem. Use the approximation sign as the
one brand gesture; do not add scattered math symbols, terminal decorations or fake equations.
Restrict graph lines to the participant ground and countdown context. Remove the current italic
serif emphasis, uppercase eyebrows, marketing footer, decorative arrows and unnecessary helper
paragraphs. Avoid equal rounded boxes for every region: only forms and controls need a writing
surface. Keep numbers, questions and state changes the focus.

## Implementation and review

- [x] Replace shared styles and font assets; update the favicon and page metadata.
- [x] Edit Polish copy across play, projector and host; keep actionable error and timing details.
- [x] Review desktop/mobile screenshots, keyboard focus, reduced motion and long-value overflow.
- [x] Run lint, type checks, unit/integration tests and real browser tests; commit verified changes.

## Verification notes

Reviewed real Chromium screenshots of registration, waiting, answering, closing, question results,
final results and the host dashboard. Checked widths 320, 390, 768 and 1440 pixels, a 24-hour timer,
a 100-digit answer, visible input/upload keyboard focus and reduced motion. Browser requests stayed
on the local origin, including the two font subsets; no browser errors were recorded.

The host loading check exposed `structuredClone` being called on a Svelte state proxy. Copying
the question objects explicitly fixes it; the new login/reload browser test reproduced the error
before the fix and verifies that both saved questions load afterwards.
