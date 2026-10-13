#!/usr/bin/env python3
"""Open a dedicated native form for the installed app's Computer Use demo."""
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import uuid

base = Path(__file__).resolve().parent
run = base / 'runtime' / ('app-demo-' + str(uuid.uuid4()))
run.mkdir(parents=True, mode=0o700)
app = run / 'gpt-bridge CU Test.app'
executable = app / 'Contents/MacOS/Probe'
executable.parent.mkdir(parents=True)
shutil.copy2(base / 'GPTBridgeTunnelProbe', executable)
with (app / 'Contents/Info.plist').open('wb') as stream:
    plistlib.dump({'CFBundleIdentifier': 'local.gptbridge.cu-demo', 'CFBundleName': 'gpt-bridge CU Test',
                  'CFBundleExecutable': 'Probe', 'CFBundlePackageType': 'APPL',
                  'NSHighResolutionCapable': True}, stream)
env = {'HOME': str(Path.home()), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
       'CU_VISUAL_CODE': 'CU-' + secrets.token_hex(4).upper(),
       'CU_RESULT_PATH': str(run / 'result.json'), 'CU_READY_PATH': str(run / 'ready')}
process = subprocess.Popen([str(executable)], env=env, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
(run / 'process.json').write_text(json.dumps({'pid': process.pid, 'app': str(app)}))
print(json.dumps({'pid': process.pid, 'name': 'gpt-bridge CU Test', 'runDirectory': str(run)}))
