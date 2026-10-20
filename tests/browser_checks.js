async page => {
    const sample = {
        cpu_percent: 22,
        ram: {used_bytes: 10 * 1024 ** 3, total_bytes: 16 * 1024 ** 3, percent: 62.5},
        comfy_ram_bytes: 3 * 1024 ** 3,
        gpus: [{name: 'NVIDIA GeForce RTX 5060 Ti', load_percent: 95, used_bytes: 12 * 1024 ** 3,
            total_bytes: 16 * 1024 ** 3, temperature_c: 64, power_w: 130, fan_percent: null}],
    };
    await page.addInitScript((sample) => {
        window.calls = [];
        window.freeStatus = 409;
        window.sample = sample;
        window.testTransport = async (path, options) => {
            window.calls.push(path);
            if (path.endsWith('/free')) return new Response(JSON.stringify(
                window.freeStatus === 409 ? {error: 'Wait until running and queued jobs finish before freeing VRAM.'} : {status: 'requested'}
            ), {status: window.freeStatus});
            return new Response(JSON.stringify(window.sample), {status: 200});
        };
    }, sample);
    await page.goto('http://127.0.0.1:8874/preview.html');
    await page.getByText('NVIDIA GeForce RTX 5060 Ti', {exact: true}).waitFor();
    if (!await page.getByText('12.0 / 16.0 GiB', {exact: true}).isVisible()) throw new Error('VRAM units incorrect');
    await page.screenshot({path: 'preview.png'});
    await page.getByRole('button', {name: 'Free VRAM', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Wait until running'}).waitFor();
    await page.evaluate(() => { window.freeStatus = 200; });
    await page.getByRole('button', {name: 'Free VRAM', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Unloading ComfyUI'}).waitFor();
    await page.evaluate(() => {window.sample.gpus = []; window.sample.gpu_error = 'GPU unavailable';});
    await page.getByText('CPU / RAM monitor', {exact: true}).waitFor();
    await page.evaluate(() => window.monitor.dispose());
    const count = await page.evaluate(() => window.calls.length);
    await page.waitForTimeout(2400);
    if (await page.evaluate(() => window.calls.length) !== count) throw new Error('Polling leaked after removal');
    console.log('PASS: rendering, GiB units, busy refusal, cleanup request, missing GPU, disposal');
}
