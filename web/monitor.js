const GiB = 1024 ** 3;
const percent = (value) => Number.isFinite(value) ? `${Math.round(value)}%` : '—';
const gib = (value) => Number.isFinite(value) ? (value / GiB).toFixed(1) : '—';

export function createMonitor(fetchApi) {
    const host = document.createElement('div');
    host.style.cssText = 'width:100%;height:100%;min-width:280px;box-sizing:border-box;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { color-scheme:dark; }
        * { box-sizing:border-box; }
        .monitor { background:#202326;color:#f0f2f3;padding:14px;font:12px/1.45 system-ui,sans-serif;height:100%;overflow:auto;scrollbar-width:thin;scrollbar-color:#65717a #202326; }
        .device { font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 12px; }
        .row { display:flex;justify-content:space-between;gap:12px;margin-top:10px; }
        .label,.detail { color:#b9c1c7; }
        .value { font-variant-numeric:tabular-nums;white-space:nowrap; }
        progress { display:block;appearance:none;border:0;width:100%;height:4px;margin:5px 0 0;background:#42484d; }
        progress::-webkit-progress-bar { background:#42484d; }
        progress::-webkit-progress-value { background:#a7d65a; }
        progress::-moz-progress-bar { background:#a7d65a; }
        progress.hot::-webkit-progress-value { background:#ffb867; }
        .detail { display:flex;justify-content:space-between;gap:8px;margin-top:14px;font-variant-numeric:tabular-nums; }
        button { width:100%;margin-top:14px;min-height:34px;border:1px solid #a7d65a;background:#a7d65a;color:#18200e;font:600 12px system-ui;cursor:pointer;border-radius:5px; }
        button:hover { background:#b9e675; }
        button:focus-visible { outline:2px solid #f0f2f3;outline-offset:3px; }
        button:disabled { background:#353b40;border-color:#535b61;color:#bdc5cb;cursor:wait; }
        .status { min-height:34px;margin:8px 0 0;color:#b9c1c7;font-size:11px; }
        .status.error { color:#ffc19e; }
        ::selection { background:#a7d65a;color:#18200e; }
      </style>
      <section class="monitor" aria-label="Hardware performance monitor">
        <p class="device">Connecting to hardware…</p>
        ${['CPU', 'RAM', 'GPU', 'VRAM'].map((name) => `
          <div class="row"><span class="label">${name}</span><span class="value" data-value="${name}">—</span></div>
          <progress data-bar="${name}" aria-label="${name} usage" max="100" value="0"></progress>
        `).join('')}
        <div class="detail"><span data-temp>— °C</span><span data-power>— W</span><span data-fan>Fan —</span></div>
        <div class="detail"><span>ComfyUI RAM</span><span data-process>— GiB</span></div>
        <button type="button">Free VRAM</button>
        <p class="status" role="status" aria-live="polite">Updates every 2 seconds · Whole GPU usage</p>
      </section>`;
    const status = root.querySelector('.status');
    const button = root.querySelector('button');
    const controller = new AbortController();
    let disposed = false;
    let timer;
    let messageUntil = 0;
    let freeing = false;
    let cleanupRequestedAt = null;

    function request(path, options = {}) {
        return fetchApi(path, {
            ...options,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
    }

    function message(text, error = false) {
        status.textContent = text;
        status.classList.toggle('error', error);
        messageUntil = Date.now() + 8000;
    }

    function row(name, text, load) {
        root.querySelector(`[data-value="${name}"]`).textContent = text;
        const bar = root.querySelector(`[data-bar="${name}"]`);
        bar.value = Number.isFinite(load) ? Math.max(0, Math.min(100, load)) : 0;
        bar.classList.toggle('hot', load >= 90);
    }

    async function poll() {
        if (disposed) return;
        try {
            if (document.hidden) return;
            const response = await request('/vallpaper/hardware');
            if (!response.ok) throw new Error('Hardware monitor unavailable. Check the ComfyUI terminal.');
            const sample = await response.json();
            const gpu = sample.gpus?.[0];
            root.querySelector('.device').textContent = gpu?.name || 'CPU / RAM monitor';
            root.querySelector('.device').title = gpu?.name || 'NVIDIA readings unavailable';
            row('CPU', percent(sample.cpu_percent), sample.cpu_percent);
            row('RAM', `${gib(sample.ram.used_bytes)} / ${gib(sample.ram.total_bytes)} GiB`, sample.ram.percent);
            row('GPU', percent(gpu?.load_percent), gpu?.load_percent);
            const vramPercent = gpu?.total_bytes && Number.isFinite(gpu.used_bytes) ? gpu.used_bytes / gpu.total_bytes * 100 : null;
            row('VRAM', `${gib(gpu?.used_bytes)} / ${gib(gpu?.total_bytes)} GiB`, vramPercent);
            root.querySelector('[data-temp]').textContent = `${gpu?.temperature_c ?? '—'} °C`;
            root.querySelector('[data-power]').textContent = `${gpu?.power_w != null ? Math.round(gpu.power_w) : '—'} W`;
            root.querySelector('[data-fan]').textContent = `Fan ${percent(gpu?.fan_percent)}`;
            root.querySelector('[data-process]').textContent = `${gib(sample.comfy_ram_bytes)} GiB`;
            if (cleanupRequestedAt && Date.now() - cleanupRequestedAt > 4000) {
                message('Cleanup requested. Readings above show current VRAM usage.');
                cleanupRequestedAt = null;
            } else if (Date.now() > messageUntil) {
                status.textContent = sample.gpu_error || 'Live · 2-second refresh · Whole GPU usage';
                status.classList.toggle('error', Boolean(sample.gpu_error));
            }
        } catch (error) {
            if (!disposed) message(error.message || 'Connection lost. Retrying…', true);
        } finally {
            if (!disposed) timer = setTimeout(poll, 2000);
        }
    }

    button.addEventListener('click', async () => {
        if (freeing) return;
        freeing = true;
        button.disabled = true;
        button.textContent = 'Requesting cleanup…';
        try {
            const response = await request('/vallpaper/hardware/free', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not request VRAM cleanup.');
            cleanupRequestedAt = Date.now();
            message('Unloading ComfyUI models… watching VRAM usage.');
        } catch (error) {
            if (!disposed) message(error.message, true);
        } finally {
            if (!disposed) {
                freeing = false;
                button.disabled = false;
                button.textContent = 'Free VRAM';
            }
        }
    });
    poll();
    return {
        element: host,
        dispose() { disposed = true; clearTimeout(timer); controller.abort(); },
    };
}
