import asyncio
import time

from aiohttp import web
from server import PromptServer

from .hardware import HardwareCollector


class VallpaperHardware:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {}}

    RETURN_TYPES = ()
    FUNCTION = 'monitor'
    CATEGORY = 'vallpaper.store'
    DESCRIPTION = 'Live CPU, RAM, GPU and VRAM. Free VRAM unloads ComfyUI models when the queue is idle. No connections needed.'

    def monitor(self):
        return ()


class VallpaperTimer:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {}}

    RETURN_TYPES = ()
    FUNCTION = 'monitor'
    CATEGORY = 'vallpaper.store'
    DESCRIPTION = 'Start a generation timer, receive completion alerts, and track queued jobs. No connections needed. Stop affects timing only.'

    def monitor(self):
        return ()


NODE_CLASS_MAPPINGS = {'VallpaperHardware': VallpaperHardware, 'VallpaperTimer': VallpaperTimer}
NODE_DISPLAY_NAME_MAPPINGS = {
    'VallpaperHardware': 'vallpaper.store · Hardware',
    'VallpaperTimer': 'vallpaper.store · Timer',
}
WEB_DIRECTORY = './web'

collector = HardwareCollector()
sample_lock = asyncio.Lock()
cached_sample = None
sampled_at = 0.0


@PromptServer.instance.routes.get('/vallpaper/hardware')
async def hardware_status(request):
    global cached_sample, sampled_at
    async with sample_lock:
        if cached_sample is None or time.monotonic() - sampled_at >= 1.5:
            cached_sample = await asyncio.to_thread(collector.sample)
            sampled_at = time.monotonic()
    return web.json_response(cached_sample, headers={'Cache-Control': 'no-store'})


@PromptServer.instance.routes.post('/vallpaper/hardware/free')
async def free_vram(request):
    running, pending = PromptServer.instance.prompt_queue.get_current_queue()
    if running or pending:
        return web.json_response(
            {'error': 'Wait until running and queued jobs finish before freeing VRAM.'}, status=409,
        )
    # Let ComfyUI's executor perform its normal cleanup, never unload in this HTTP thread.
    PromptServer.instance.prompt_queue.set_flag('unload_models', True)
    PromptServer.instance.prompt_queue.set_flag('free_memory', True)
    return web.json_response({'status': 'requested'})
