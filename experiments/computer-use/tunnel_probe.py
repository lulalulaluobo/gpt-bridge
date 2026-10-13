"""Temporary tunnel switch; credentials stay in captured process memory/environment."""
import hashlib, json, os, pathlib, shlex, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent
STATE = ROOT / 'runtime'
APP = pathlib.Path('/Applications/gpt-bridge.app/Contents/Resources')
LIVE = pathlib.Path.home() / 'Library/Application Support/MacBridge'
NODE = str(APP / 'runtime/bin/node')
TUNNEL = str(APP / 'runtime/bin/tunnel-client')
CONTROL = str(APP / 'bridge/control.mjs')
ALIAS = 'gpt-bridge-cu-test'
ENV = {'HOME': str(pathlib.Path.home()), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8'}

def save(name, data):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    p = STATE / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    p.chmod(0o600)

def run(cmd, env=ENV, payload=None):
    p = subprocess.run(cmd, env=env, input=None if payload is None else json.dumps(payload), text=True, capture_output=True, timeout=65)
    if p.returncode: raise RuntimeError('Local runtime operation failed; credentials and raw diagnostics suppressed.')
    result = json.loads(p.stdout)
    if result.get('error'): raise RuntimeError('Runtime returned an error; operation stopped.')
    return result

def live(action, key=None, connection=None):
    return run([NODE, CONTROL, action, str(LIVE)], env={**ENV, **({'MACBRIDGE_RUNTIME_KEY': key} if key else {})}, payload=connection)

def native(action, args=(), key=None):
    return run([TUNNEL, 'runtimes', action, *args, '--json'], env={**ENV, 'TUNNEL_CLIENT_STATE_DIR': str(STATE / 'state'), 'MCP_MAX_CONCURRENT_REQUESTS': '1', 'LOG_HTTP_RAW_UNSAFE': 'false', **({'MACBRIDGE_RUNTIME_KEY': key} if key else {})})

def credential(account):
    p = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', 'local.macbridge.desktop.runtime', '-a', account, '-w'], capture_output=True, timeout=60)
    if p.returncode: raise RuntimeError('Keychain access was not granted. No key was printed.')
    key = p.stdout.decode().strip()
    if not key or any(c in key for c in '\r\n\0'): raise RuntimeError('Invalid credential format.')
    return key

def brief(s):
    return {k:s.get(k) for k in ['process_running','running','healthy','ready','activeTasks','pid','activeWorkspaceFingerprint'] if k in s}

def restore(key=None):
    backup = json.loads((STATE / 'restore.json').read_text())
    if key is None: key = credential(backup['active']['id'])
    listing = native('list')
    if any((a if isinstance(a,str) else a.get('alias')) == ALIAS for a in listing.get('aliases',[])):
        native('stop', [ALIAS])
        if native('status',[ALIAS]).get('process_running'): raise RuntimeError('Test runtime is still running; normal runtime not restarted.')
    # Reap only this gateway/fixture if the runtime manager left a descendant.
    run_file = STATE / 'e2e/run.json'
    if run_file.exists():
        data = json.loads(run_file.read_text())
        for field, signature in [('pid',str(ROOT / 'tunnel-gateway.mjs')),('guiPID',str(ROOT / 'GPTBridgeTunnelProbe'))]:
            pid = data[field]
            p = subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
            if signature in p.stdout: os.kill(pid,15)
        time.sleep(1)
        for field, signature in [('pid',str(ROOT / 'tunnel-gateway.mjs')),('guiPID',str(ROOT / 'GPTBridgeTunnelProbe'))]:
            p = subprocess.run(['/bin/ps','-p',str(data[field]),'-o','command='],capture_output=True,text=True)
            if signature in p.stdout: raise RuntimeError('Test child still alive; restart blocked.')
    a = backup['active']
    connection = {k:a[k] for k in ['id','name','tunnelID']}
    connection.update(workspaces=[a['activeWorkspace']],selectedWorkspaceID=a['activeWorkspace']['id'])
    current_hash=hashlib.sha256((LIVE/'connections.json').read_bytes()).hexdigest()
    if current_hash!=backup['configurationSHA256']:
        raise RuntimeError('User configuration changed during testing. Test stopped; reconnect through the app to apply latest settings.')
    status=live('start',key,connection)
    if not all(status.get(k) for k in ['running','healthy','ready']) or status.get('activeWorkspaceFingerprint')!=a['fingerprint']:
        raise RuntimeError('Normal runtime restoration not verified.')
    save('restored.json',{'at':time.time(),'status':brief(status)})
    print('RESTORED',json.dumps(brief(status)),flush=True)

def start():
    status=live('status')
    if not status.get('running') or status.get('activeTasks')!=0: raise RuntimeError('Normal service must be running and idle before switching.')
    if (STATE/'restore.json').exists(): raise RuntimeError('A prior experiment snapshot exists; inspect/restore it before starting another.')
    active=json.loads((LIVE/'active.json').read_text())
    key=credential(active['id']) # Before interrupting the normal runtime.
    save('restore.json',{'active':active,'configurationSHA256':hashlib.sha256((LIVE/'connections.json').read_bytes()).hexdigest(),'before':brief(status)})
    stopped=live('stop')
    if stopped.get('running'): raise RuntimeError('Normal service did not stop.')
    try:
        command=shlex.join([NODE,str(ROOT/'tunnel-gateway.mjs')])
        native('connect',['--alias',ALIAS,'--profile','cu-probe','--profile-dir',str(STATE/'profiles'),'--tunnel-id',active['tunnelID'],'--mcp-command',command,'--runtime-api-key','env:MACBRIDGE_RUNTIME_KEY','--control-plane-base-url','https://api.openai.com'],key)
        status=native('status',[ALIAS])
        if not all(status.get(k) for k in ['process_running','healthy','ready']): raise RuntimeError('Test tunnel did not become ready.')
        save('connected.json',{'at':time.time(),'status':brief(status)})
        print('TEST_READY',json.dumps(brief(status)),flush=True)
    except Exception:
        restore(key)
        raise

try:
    action=sys.argv[1]
    if action=='start': start()
    elif action=='restore': restore()
    elif action=='status': print(json.dumps(brief(native('status',[ALIAS]))))
    else: raise RuntimeError('Use start, status, or restore.')
except Exception as e:
    print(type(e).__name__+': '+str(e),file=sys.stderr)
    sys.exit(1)
