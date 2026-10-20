// Timing state stays independent of the DOM and ComfyUI transport.
export class TimerSession {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.armed = false;
        this.active = null;
        this.history = [];
        this.seen = new Set();
        this.armedAt = null;
    }

    start() {
        if (this.armed) return;
        this.armedAt = this.now();
        this.seen.clear();
        this.armed = true;
        this.active = {id: null, startedAt: this.armedAt};
    }

    observeStart(id, timestamp) {
        if (!this.armed || !id || this.seen.has(id) || this.active?.id === id) return [];
        if (this.active && this.active.id === null) {
            // The first timer begins at the user's click, including any queue wait.
            this.active.id = id;
            return [];
        }
        const ended = this.active ? [this.finish('Next job started', this.now())] : [];
        const startedAt = Number.isFinite(timestamp) ? Math.min(timestamp, this.now()) : this.now();
        this.active = {id, startedAt: Math.max(this.armedAt, startedAt)};
        return ended;
    }

    complete(id, outcome, timestamp) {
        if (!this.armed || !this.active || !id || this.seen.has(id)) return null;
        if (this.active.id !== null && this.active.id !== id) return null;
        this.active.id = id;
        return this.finish(outcome, Number.isFinite(timestamp) ? timestamp : this.now());
    }

    finish(outcome, endedAt) {
        const row = {
            ...this.active,
            endedAt: Math.max(this.active.startedAt, endedAt),
            outcome,
        };
        row.duration = row.endedAt - row.startedAt;
        if (row.id) this.seen.add(row.id);
        this.history.unshift(row);
        this.history = this.history.slice(0, 10);
        this.active = null;
        return row;
    }

    stop() {
        if (this.active) this.finish('Stopped', this.now());
        this.armed = false;
    }

    reset() {
        this.armed = false;
        this.active = null;
        this.history = [];
        this.seen.clear();
        this.armedAt = null;
    }

    elapsed() {
        return this.active ? Math.max(0, this.now() - this.active.startedAt) : this.history[0]?.duration || 0;
    }
}

export function durationText(milliseconds) {
    const tenths = Math.floor(Math.max(0, milliseconds) / 100);
    const seconds = Math.floor(tenths / 10);
    return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}
