# Changelog

## Automatic Run-button timing

- Start timing automatically from ComfyUI's Run/Generate submission event and keyboard queue shortcuts.
- Fall back to automatic execution-start timing when the submission event is unavailable.
- Preserve the active timer when additional jobs are queued; the next local Run click re-arms after Stop/Reset.

## Timer update

- Add **vallpaper.store · Timer** without changing the Hardware node name.
- Record click time, elapsed time, completion time, and a 10-entry interval history.
- Continue timing subsequent queued generations with separate intervals.
- Add optional sound and desktop alerts for generation outcomes, plus desktop alerts when the next job starts.
- Handle errors, cancellation, duplicate events, missed-event recovery, and node removal.
- Keep Stop and Reset independent of generation execution.
- Add state and isolated browser tests, a timer preview, and usage documentation.

## Initial release

- Add **vallpaper.store · Hardware**, local hardware sampling, and idle model cleanup.
