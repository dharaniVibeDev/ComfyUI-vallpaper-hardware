import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import { createTimer } from './timer-ui.js';

app.registerExtension({
    name: 'vallpaper.store.timer',
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== 'VallpaperTimer') return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = originalCreated?.apply(this, args);
            const timer = createTimer(api);
            const widget = this.addDOMWidget('timer', 'vallpaper-timer', timer.element, {serialize: false});
            widget.computeSize = () => [330, 410];
            this.setSize([360, 450]);
            const originalRemoved = this.onRemoved;
            this.onRemoved = function (...removedArgs) {
                timer.dispose();
                return originalRemoved?.apply(this, removedArgs);
            };
            return result;
        };
    },
});
