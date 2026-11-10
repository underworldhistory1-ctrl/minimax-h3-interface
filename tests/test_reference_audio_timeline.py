import ast
import asyncio
import unittest
from pathlib import Path

SOURCE = ast.parse((Path(__file__).parents[1] / '__init__.py').read_text(encoding='utf-8'))

class ReferenceTimelineTests(unittest.TestCase):
    def test_plain_and_delayed_24fps_admission(self):
        assignment = next(n for n in ast.walk(SOURCE) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'needs_norm' for t in n.targets))
        for offset, expected in [(0, False), (2.978, True)]:
            scope = dict(info=dict(fps=24, source_width=640, source_height=360, audio_start_offset=offset), resize=True, trim_start=0, trim_duration=None)
            exec(compile(ast.Module(body=[assignment], type_ignores=[]), '<upload>', 'exec'), scope)
            self.assertEqual(scope['needs_norm'], expected)

    def test_audio_filter_reaches_ffmpeg(self):
        function = next(n for n in SOURCE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_normalize_reference_video')
        commands = []
        class Process:
            returncode = 0
            async def communicate(self): return b'', b''
        async def create(*args, **kwargs):
            commands.append(args)
            return Process()
        class Async:
            subprocess = type('Subprocess', (), dict(DEVNULL=-1, PIPE=-1))
            create_subprocess_exec = staticmethod(create)
            wait_for = staticmethod(asyncio.wait_for)
            TimeoutError = asyncio.TimeoutError
            CancelledError = asyncio.CancelledError
        scope = dict(asyncio=Async)
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<normalize>', 'exec'), scope)
        asyncio.run(scope['_normalize_reference_video']('input.mp4', 'output.mp4', has_audio=True))
        self.assertIn('aresample=48000:async=1:first_pts=0', commands[0])
