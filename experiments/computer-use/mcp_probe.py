import base64, json, pathlib, queue, subprocess, threading, sys

root = pathlib.Path(__file__).resolve().parent
out = root / 'evidence'
out.mkdir(exist_ok=True)
binary = root / 'peekaboo/peekaboo-macos-arm64/peekaboo'
stderr = (out / 'mcp-stderr.log').open('w')
proc = subprocess.Popen([str(binary), 'mcp', '--no-remote'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True)
messages = queue.Queue()
def reader():
    for line in proc.stdout:
        try: messages.put(json.loads(line))
        except json.JSONDecodeError: pass
threading.Thread(target=reader, daemon=True).start()
counter = 0
def send(payload):
    proc.stdin.write(json.dumps(payload) + '\n'); proc.stdin.flush()
def rpc(method, params):
    global counter
    counter += 1
    send({'jsonrpc':'2.0','id':counter,'method':method,'params':params})
    while True:
        response = messages.get(timeout=45)
        if response.get('id') == counter: break
    (out / f'{counter:02d}-{method.replace("/", "-")}.json').write_text(json.dumps(response, ensure_ascii=False, indent=2))
    return response
def display(response):
    for block in response.get('result',{}).get('content',[]):
        if block.get('type') == 'image':
            image = out / f'{counter:02d}-capture.png'
            image.write_bytes(base64.b64decode(block['data']))
            print('IMAGE',image,flush=True)
        elif block.get('type') == 'text': print(block.get('text','')[:14000],flush=True)
    if 'error' in response: print(json.dumps(response['error']),flush=True)
try:
    response = rpc('initialize', {'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'gpt-bridge-independent-probe','version':'0.1'}})
    print('INITIALIZE',json.dumps(response),flush=True)
    send({'jsonrpc':'2.0','method':'notifications/initialized'})
    listing = rpc('tools/list', {})
    print('TOOLS',[(t['name']) for t in listing.get('result',{}).get('tools',[])],flush=True)
    for line in sys.stdin:
        if line.strip() == 'quit': break
        request = json.loads(line)
        display(rpc('tools/call', request))
except Exception as error:
    print(type(error).__name__,str(error),flush=True)
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    stderr.close()
