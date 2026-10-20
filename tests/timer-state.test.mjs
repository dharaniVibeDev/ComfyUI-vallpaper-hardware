import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../web/timer-state.js', import.meta.url), 'utf8');
const {TimerSession, durationText} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup() {
    let now = 100000;
    return {timer: new TimerSession(() => now), advance: (ms) => {now += ms;}};
}

test('click starts immediately; first job includes waiting after the click', () => {
    const {timer, advance} = setup();
    timer.start(); advance(5000); timer.observeStart('a', 105000); advance(7000);
    assert.equal(timer.complete('a', 'Completed').duration, 12000);
    assert.equal(timer.history[0].startedAt, 100000);
    assert.equal(timer.armed, true);
    assert.equal(timer.active, null);
});

test('next queued job starts its own clock; duplicates and stale completions are ignored', () => {
    const {timer, advance} = setup();
    timer.start(); timer.observeStart('a'); advance(2000); timer.complete('a', 'Completed');
    advance(1000); timer.observeStart('b'); advance(4000);
    assert.equal(timer.complete('a', 'Completed'), null);
    assert.equal(timer.complete('b', 'Completed').duration, 4000);
    assert.equal(timer.complete('b', 'Completed'), null);
    assert.equal(timer.history.length, 2);
});

test('next-start fallback saves previous result without claiming successful generation', () => {
    const {timer, advance} = setup();
    timer.start(); timer.observeStart('a'); advance(3000);
    const rows = timer.observeStart('b');
    assert.equal(rows[0].outcome, 'Next job started');
    assert.equal(rows[0].duration, 3000);
    assert.equal(timer.active.id, 'b');
    assert.equal(timer.complete('a', 'Completed'), null);
});

test('stop and reset disarm; late events cannot restart the timer', () => {
    const {timer, advance} = setup();
    timer.start(); timer.observeStart('a'); advance(1000); timer.stop();
    timer.observeStart('b');
    assert.equal(timer.active, null);
    assert.equal(timer.complete('a', 'Completed'), null);
    assert.equal(timer.history[0].outcome, 'Stopped');
    timer.reset();
    assert.equal(timer.history.length, 0);
    assert.equal(timer.elapsed(), 0);
    assert.equal(timer.armed, false);
});

test('restart can attach to the same still-running generation', () => {
    const {timer, advance} = setup();
    timer.start(); timer.observeStart('a'); advance(1000); timer.stop();
    timer.start(); timer.observeStart('a'); advance(2000);
    assert.equal(timer.complete('a', 'Completed').duration, 2000);
});

test('failure, cancellation and history limit', () => {
    const {timer, advance} = setup();
    timer.start();
    for (let i = 0; i < 12; i++) {
        timer.observeStart(String(i)); advance(1000);
        timer.complete(String(i), i % 2 ? 'Cancelled' : 'Failed');
    }
    assert.equal(timer.history.length, 10);
    assert.equal(timer.history[0].outcome, 'Cancelled');
    assert.equal(timer.history[1].outcome, 'Failed');
});

test('elapsed uses timestamps so throttled UI updates do not lose time', () => {
    const {timer, advance} = setup();
    timer.start(); advance(3600123);
    assert.equal(durationText(timer.elapsed()), '01:00:00.1');
    assert.equal(durationText(-20), '00:00:00.0');
});
