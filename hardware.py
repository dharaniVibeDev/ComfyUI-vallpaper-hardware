import csv
import io
import os
import shutil
import subprocess
import time

import psutil

GPU_FIELDS = 'index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed'


def number(value):
    try:
        return float(value.strip())
    except (ValueError, AttributeError):
        return None


def parse_gpus(output):
    result = []
    for row in csv.reader(io.StringIO(output)):
        if len(row) != 8:
            continue
        index, name, load, used, total, temperature, power, fan = row
        result.append({
            'index': number(index), 'name': name.strip(), 'load_percent': number(load),
            'used_bytes': number(used) * 1048576 if number(used) is not None else None,
            'total_bytes': number(total) * 1048576 if number(total) is not None else None,
            'temperature_c': number(temperature), 'power_w': number(power),
            'fan_percent': number(fan),
        })
    return result


class HardwareCollector:
    def __init__(self):
        self.process = psutil.Process()
        self.smi = shutil.which('nvidia-smi')
        psutil.cpu_percent(interval=None)

    def sample(self):
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        result = {
            'sampled_at': time.time(),
            'cpu_percent': psutil.cpu_percent(interval=None),
            'ram': {'used_bytes': memory.total - memory.available,
                    'total_bytes': memory.total, 'percent': memory.percent},
            'swap': {'used_bytes': swap.used, 'total_bytes': swap.total},
            'comfy_ram_bytes': self.process.memory_info().rss,
            'gpus': [], 'gpu_error': None,
        }
        if not self.smi:
            result['gpu_error'] = 'NVIDIA readings unavailable: nvidia-smi was not found.'
            return result
        try:
            completed = subprocess.run(
                [self.smi, '--query-gpu=' + GPU_FIELDS, '--format=csv,noheader,nounits'],
                capture_output=True, text=True, timeout=3, check=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            )
            result['gpus'] = parse_gpus(completed.stdout)
            if not result['gpus']:
                result['gpu_error'] = 'NVIDIA returned no readable GPU samples.'
        except (OSError, subprocess.SubprocessError):
            result['gpu_error'] = 'NVIDIA readings unavailable. Retrying automatically.'
        return result
