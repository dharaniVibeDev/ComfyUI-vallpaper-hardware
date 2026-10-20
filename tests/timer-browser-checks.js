async page => {
    await page.addInitScript(() => {
        window.timerAlerts = [];
        window.permissionRequests = 0;
        window.audioStarts = 0;
        window.AudioContext = class {
            state = 'running'; currentTime = 0; destination = {};
            async resume() {}
            async close() {this.state = 'closed';}
            createOscillator() {return {frequency:{value:0},connect(){},disconnect(){},start(){window.audioStarts++;},stop(){}};}
            createGain() {return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
        };
        window.Notification = class {
            static permission = 'default';
            static async requestPermission() {
                window.permissionRequests++;
                this.permission = 'granted';
                return 'granted';
            }
            constructor(title, options) {window.timerAlerts.push({title, ...options});}
            close() {}
        };
    });
    await page.goto('http://127.0.0.1:8874/timer-preview.html');
    const start = page.getByRole('button', {name: 'Start', exact: true});
    const stop = page.getByRole('button', {name: 'Stop', exact: true});
    await start.waitFor();
    if (await page.evaluate(() => window.permissionRequests) !== 0) throw new Error('Unsolicited notification permission');
    await page.getByLabel('Desktop alert', {exact: true}).check();
    if (await page.evaluate(() => window.permissionRequests) !== 1) throw new Error('Permission control failed');
    await page.getByLabel('Sound', {exact: true}).uncheck();
    await page.evaluate(() => window.timerApi.dispatchEvent(new CustomEvent('promptQueueing', {detail:{requestId:1}})));
    if (!await start.isDisabled()) throw new Error('ComfyUI Run did not start the timer automatically');
    await page.getByRole('button', {name: 'Simulate job', exact: true}).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', {name: 'Next queued job', exact: true}).click();
    await page.getByRole('cell', {name: 'Completed', exact: true}).waitFor();
    await page.getByRole('status').filter({hasText: 'Next generation started'}).waitFor();
    const alerts = await page.evaluate(() => window.timerAlerts);
    if (!alerts.some(a => a.body.includes('Completed')) || !alerts.some(a => a.body.includes('Next generation started'))) throw new Error('Missing completion or next-job notification');
    await page.getByRole('button', {name: 'Finish job', exact: true}).click();
    await page.evaluate(() => window.emitTimerEvent('execution_success', {prompt_id:'preview-2', timestamp:Date.now()}));
    if (await page.getByRole('cell', {name: 'Completed', exact: true}).count() !== 2) throw new Error('Duplicate or missing history');
    await page.screenshot({path:'docs/timer-preview.png'});
    await stop.click();
    await page.getByRole('button', {name: 'Reset', exact: true}).click();
    await page.getByText('No recorded generations yet.', {exact:true}).waitFor();
    await page.evaluate(() => window.emitTimerEvent('execution_start', {prompt_id:'ignored'}));
    if (await start.isDisabled()) throw new Error('Reset did not disarm');
    await start.click();
    await page.evaluate(() => {
        window.emitTimerEvent('execution_start', {prompt_id:'failed'});
        window.emitTimerEvent('execution_error', {prompt_id:'failed', timestamp:Date.now()});
    });
    await page.getByRole('cell', {name:'Failed',exact:true}).waitFor();
    await page.evaluate(() => {
        window.emitTimerEvent('execution_start', {prompt_id:'cancelled'});
        window.emitTimerEvent('execution_interrupted', {prompt_id:'cancelled', timestamp:Date.now()});
    });
    await page.getByRole('cell', {name:'Cancelled',exact:true}).waitFor();
    await page.getByRole('button', {name:'Reset',exact:true}).click();
    await page.getByLabel('Sound', {exact:true}).check();
    await page.evaluate(() => {
        window.recoveryDone = false;
        window.timerApi.fetchApi = async (path) => {
            if (path === '/queue') return new Response(JSON.stringify({queue_running:window.recoveryDone ? [] : [[0,'recovered']]}));
            window.recoveryDone = true;
            return new Response(JSON.stringify({recovered:{status:{messages:[['execution_success',{prompt_id:'recovered',timestamp:Date.now()}]]}}}));
        };
    });
    await start.click();
    await page.getByRole('cell', {name:'Completed',exact:true}).waitFor({timeout:7000});
    if (await page.evaluate(() => window.audioStarts) !== 2) throw new Error('Completion sound was not scheduled');
    await page.evaluate(() => window.timerUI.dispose());
    const count = await page.getByRole('row').count();
    await page.evaluate(() => {
        window.emitTimerEvent('execution_start', {prompt_id:'removed'});
        window.emitTimerEvent('execution_success', {prompt_id:'removed',timestamp:Date.now()});
    });
    if (await page.getByRole('row').count() !== count) throw new Error('Listeners leaked after removal');
    console.log('PASS: start, completion, automatic next-job timing, desktop permission and notifications, duplicate suppression, reset, errors, cancellation, queue/history recovery, sound scheduling and disposal');
}
