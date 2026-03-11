import subprocess, os
frontend = r'C:\Users\Henrik.Nilsson\OneDrive - Advisense AB\Desktop\Claude01_SalesSupport\frontend'
node_bin = r'C:\Users\Henrik.Nilsson\AppData\Local\node-portable'
env = os.environ.copy()
env['PATH'] = node_bin + ';' + env.get('PATH', '')
result = subprocess.run(
    [os.path.join(node_bin, 'npx.cmd'), 'tsc', '--noEmit'],
    cwd=frontend, env=env, capture_output=True, text=True, timeout=120
)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("RETURN CODE:", result.returncode)
