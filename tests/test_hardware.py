import importlib.util
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware import HardwareCollector, parse_gpus


class HardwareTests(unittest.TestCase):
    def test_nvidia_units_and_unavailable_readings(self):
        gpu = parse_gpus('0, NVIDIA GeForce RTX 5060 Ti, 42, 8192, 16311, 61, 112.4, [N/A]\n')[0]
        self.assertEqual(gpu['used_bytes'], 8 * 1024 ** 3)
        self.assertEqual(gpu['load_percent'], 42)
        self.assertEqual(gpu['power_w'], 112.4)
        self.assertIsNone(gpu['fan_percent'])

    def test_no_gpu_still_reports_cpu_and_ram(self):
        collector = HardwareCollector()
        collector.smi = None
        result = collector.sample()
        self.assertGreater(result['ram']['total_bytes'], 0)
        self.assertGreaterEqual(result['cpu_percent'], 0)
        self.assertEqual(result['gpus'], [])
        self.assertIsNotNone(result['gpu_error'])

    def test_nvidia_timeout_does_not_break_monitor(self):
        collector = HardwareCollector()
        collector.smi = 'nvidia-smi'
        with patch('hardware.subprocess.run', side_effect=subprocess.TimeoutExpired('nvidia-smi', 3)):
            result = collector.sample()
        self.assertEqual(result['gpus'], [])
        self.assertIsNotNone(result['gpu_error'])


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.queue = Mock()
        self.queue.get_current_queue.return_value = ([], [])
        routes = Mock()
        routes.get.side_effect = lambda path: lambda function: function
        routes.post.side_effect = lambda path: lambda function: function
        server = types.ModuleType('server')
        server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes, prompt_queue=self.queue))
        spec = importlib.util.spec_from_file_location('vallpaper_test_plugin', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
        self.module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.module
        with patch.dict(sys.modules, {'server': server}):
            spec.loader.exec_module(self.module)

    async def test_cleanup_uses_executor_flags_when_idle(self):
        response = await self.module.free_vram(None)
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.body)['status'], 'requested')
        self.assertEqual(self.queue.set_flag.call_count, 2)
        self.queue.set_flag.assert_any_call('unload_models', True)
        self.queue.set_flag.assert_any_call('free_memory', True)

    async def test_cleanup_refuses_running_or_pending_jobs(self):
        for queue in [(['running'], []), ([], ['pending'])]:
            with self.subTest(queue=queue):
                self.queue.get_current_queue.return_value = queue
                response = await self.module.free_vram(None)
                self.assertEqual(response.status, 409)
        self.queue.set_flag.assert_not_called()

    async def test_samples_shared_between_clients(self):
        self.module.collector.sample = Mock(return_value={'cpu_percent': 25})
        first = await self.module.hardware_status(None)
        second = await self.module.hardware_status(None)
        self.assertEqual(first.body, second.body)
        self.module.collector.sample.assert_called_once()


if __name__ == '__main__':
    unittest.main()
