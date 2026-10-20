import {TimerSession, durationText} from './timer-state.js';

const outcomes = {
    execution_success: 'Completed', execution_error: 'Failed', execution_interrupted: 'Cancelled',
};
const clock = (value) => new Date(value).toLocaleTimeString([], {hour12: false});

export function createTimer(api) {
    const host = document.createElement('div');
    host.style.cssText = 'width:100%;height:100%;min-width:290px;';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = `
      <style>
        :host {color-scheme:dark} * {box-sizing:border-box}
        section {height:100%;overflow:auto;background:#202326;color:#f0f2f3;padding:14px;font:12px/1.45 system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:#65717a #202326}
        .elapsed {font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2;margin:0 0 8px}
        .times {display:flex;justify-content:space-between;gap:8px;color:#b9c1c7;font-variant-numeric:tabular-nums}
        .buttons {display:flex;gap:7px;margin:14px 0 12px}
        button {min-height:34px;padding:6px 12px;border:1px solid #65717a;border-radius:5px;background:#30383e;color:#f0f2f3;font:600 12px system-ui;cursor:pointer;flex:1}
        button.start {background:#a7d65a;border-color:#a7d65a;color:#18200e}
        button:hover {filter:brightness(1.12)} button:disabled {opacity:.5;cursor:default;filter:none}
        button:focus-visible,input:focus-visible {outline:2px solid #f0f2f3;outline-offset:3px}
        .options {display:flex;flex-wrap:wrap;gap:8px 16px;color:#d6dce0} label {display:flex;align-items:center;gap:6px;cursor:pointer}
        input {accent-color:#a7d65a;margin:0;width:14px;height:14px}
        .status {min-height:44px;margin:12px 0 0;color:#b9c1c7} .status.error {color:#ffc19e}
        h2 {font-size:12px;font-weight:600;margin:10px 0 7px}
        table {width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}
        th {text-align:left;color:#b9c1c7;font-weight:500;padding:0 0 6px} td {padding:7px 0;border-top:1px solid #42484d}
        th:last-child,td:last-child {text-align:right} .empty,.note {color:#b9c1c7;font-size:11px;margin:8px 0}
        ::selection {background:#a7d65a;color:#18200e}
      </style>
      <section aria-label="Generation timer">
        <div class="elapsed" aria-label="Elapsed time">00:00:00.0</div>
        <div class="times"><span data-start>Started —</span><span data-end>Ended —</span></div>
        <div class="buttons">
          <button type="button" class="start">Start</button>
          <button type="button" class="stop" disabled title="Stop timing only; generation keeps running.">Stop</button>
          <button type="button" class="reset" title="Clear timer and history; generation keeps running.">Reset</button>
        </div>
        <div class="options">
          <label><input class="sound" type="checkbox" checked>Sound</label>
          <label><input class="desktop" type="checkbox">Desktop alert</label>
        </div>
        <p class="status" role="status" aria-live="polite">Click Start before generation, or while it is running.</p>
        <h2>Recent generations</h2>
        <table aria-label="Generation history"><thead><tr><th>Started</th><th>Result</th><th>Duration</th></tr></thead><tbody></tbody></table>
        <p class="empty">No recorded generations yet.</p>
        <p class="note">Tracks the server queue while armed. Timing and history reset on page reload.</p>
      </section>`;
    const session = new TimerSession();
    const startButton = root.querySelector('.start');
    const stopButton = root.querySelector('.stop');
    const sound = root.querySelector('.sound');
    const desktop = root.querySelector('.desktop');
    const status = root.querySelector('.status');
    const controller = new AbortController();
    const listeners = [];
    let disposed = false;
    let audio = null;
    let polling = false;
    let revision = 0;
    let messageUntil = 0;

    function message(text, error = false) {
        status.textContent = text;
        status.classList.toggle('error', error);
        messageUntil = Date.now() + 7000;
    }

    async function unlockAudio() {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        try {
            audio ||= new Context();
            await audio.resume();
        } catch { message('Sound is unavailable. In-node alerts still work.', true); }
    }

    function beep() {
        if (!sound.checked || !audio || audio.state !== 'running') return;
        for (const offset of [0, 0.23]) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = 660;
            gain.gain.setValueAtTime(0, audio.currentTime + offset);
            gain.gain.linearRampToValueAtTime(0.12, audio.currentTime + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.18);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.onended = () => {oscillator.disconnect(); gain.disconnect();};
            oscillator.start(audio.currentTime + offset);
            oscillator.stop(audio.currentTime + offset + 0.2);
        }
    }

    function desktopAlert(text) {
        if (desktop.checked && 'Notification' in window && Notification.permission === 'granted') {
            try {
                const alert = new Notification('vallpaper.store · Timer', {body: text, tag: 'vallpaper-timer'});
                alert.onclick = () => {window.focus(); alert.close();};
            } catch { message(`${text} Desktop alert could not be shown.`, true); }
        }
    }

    function completed(row) {
        if (!row || disposed) return;
        const next = session.active?.id ? 'Next generation is running.' : 'Waiting for the next generation.';
        const text = `${row.outcome} · ${durationText(row.duration)}. ${next}`;
        message(text, row.outcome === 'Failed' || row.outcome === 'Cancelled');
        beep();
        desktopAlert(text);
        renderHistory();
    }

    function renderHistory() {
        const body = root.querySelector('tbody');
        body.replaceChildren();
        for (const row of session.history) {
            const tr = document.createElement('tr');
            tr.title = `Started ${new Date(row.startedAt).toLocaleString()} · Ended ${new Date(row.endedAt).toLocaleString()}${row.id ? ` · ${row.id}` : ''}`;
            for (const value of [clock(row.startedAt), row.outcome, durationText(row.duration)]) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            }
            body.appendChild(tr);
        }
        root.querySelector('.empty').hidden = session.history.length > 0;
        render();
    }

    function render() {
        root.querySelector('.elapsed').textContent = durationText(session.elapsed());
        const current = session.active || session.history[0];
        root.querySelector('[data-start]').textContent = `Started ${current ? clock(current.startedAt) : '—'}`;
        root.querySelector('[data-end]').textContent = `Ended ${!session.active && current ? clock(current.endedAt) : '—'}`;
        startButton.disabled = session.armed;
        stopButton.disabled = !session.armed;
        if (session.armed && Date.now() > messageUntil) {
            status.textContent = session.active?.id ? 'Timing generation… Next queued jobs start automatically.' : 'Armed · waiting for the next generation.';
            status.classList.remove('error');
        }
    }

    function observeStart(id, timestamp) {
        const previousId = session.active?.id;
        const ended = session.observeStart(id, timestamp);
        ended.forEach(completed);
        if (!ended.length && id && session.active?.id === id && previousId !== id && session.history.length) {
            const text = `Next generation started · previous duration ${durationText(session.history[0].duration)}.`;
            message(text);
            desktopAlert(text);
        }
        render();
    }

    function terminal(type, data) {
        const row = session.complete(data?.prompt_id, outcomes[type], data?.timestamp);
        completed(row);
    }

    function listen(type, callback) {
        api.addEventListener(type, callback);
        listeners.push([type, callback]);
    }
    listen('execution_start', (event) => observeStart(event.detail?.prompt_id, event.detail?.timestamp));
    for (const type of Object.keys(outcomes)) listen(type, (event) => terminal(type, event.detail));
    listen('reconnected', () => reconcile());

    async function get(path) {
        const response = await api.fetchApi(path, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
        if (!response.ok) throw new Error('Cannot read the ComfyUI queue. Retrying…');
        return response.json();
    }

    async function reconcile() {
        if (disposed || !session.armed || polling) return;
        polling = true;
        const version = revision;
        try {
            const id = session.active?.id;
            if (id) {
                const history = await get(`/history/${encodeURIComponent(id)}`);
                if (disposed || version !== revision || !session.armed) return;
                const messages = history[id]?.status?.messages || [];
                const end = [...messages].reverse().find(([type]) => outcomes[type]);
                if (end) terminal(end[0], {...end[1], prompt_id: id});
            }
            const queue = await get('/queue');
            if (disposed || version !== revision || !session.armed) return;
            const running = queue.queue_running?.[0];
            if (running) observeStart(running[1]);
        } catch (error) {
            if (!disposed && version === revision && session.armed) message(error.message, true);
        } finally { polling = false; }
    }

    startButton.addEventListener('click', () => {
        revision++;
        session.start();
        if (sound.checked) unlockAudio();
        message('Timer started now. Waiting for a generation, or attaching to the current one.');
        render();
        reconcile();
    });
    stopButton.addEventListener('click', () => {
        revision++;
        session.stop();
        message('Timer stopped. Generation is unaffected.');
        renderHistory();
    });
    root.querySelector('.reset').addEventListener('click', () => {
        revision++;
        session.reset();
        message('Timer and history cleared. Click Start to record again.');
        renderHistory();
    });
    sound.addEventListener('change', () => {if (sound.checked) unlockAudio();});
    if (!('Notification' in window)) {
        desktop.disabled = true;
        desktop.title = 'Desktop notifications are unavailable in this browser.';
    }
    desktop.addEventListener('change', async () => {
        if (!desktop.checked) return;
        try {
            const permission = await Notification.requestPermission();
            if (disposed) return;
            desktop.checked = permission === 'granted';
            if (!desktop.checked) message('Desktop alerts were not allowed. In-node and sound alerts still work.', true);
        } catch {desktop.checked = false; message('Desktop notifications are unavailable.', true);}
    });
    const ticker = setInterval(render, 200);
    const queuePoll = setInterval(reconcile, 3000);
    return {
        element: host,
        dispose() {
            disposed = true;
            clearInterval(ticker);
            clearInterval(queuePoll);
            controller.abort();
            listeners.forEach(([type, callback]) => api.removeEventListener(type, callback));
            audio?.close().catch(() => {});
        },
    };
}
