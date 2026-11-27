// `bun run dev`: start the web app (Vite + /api plugin) and the game server together.
const apps = [
  { name: 'web', filter: '@wobble/web' },
  { name: 'server', filter: '@wobble/server' },
];

const procs = apps.map(({ name, filter }) => {
  const child = Bun.spawn(['bun', 'run', '--filter', filter, 'dev'], {
    stdout: 'pipe',
    stderr: 'pipe',
    onExit(_proc, code) {
      console.log(`[${name}] exited with code ${code}`);
      shutdown(code ?? 0);
    },
  });
  const pipe = async (stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      for (const line of decoder.decode(r.value, { stream: true }).split('\n'))
        if (line) out.write(`[${name}] ${line}\n`);
    }
  };
  void pipe(child.stdout, process.stdout);
  void pipe(child.stderr, process.stderr);
  return child;
});

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
