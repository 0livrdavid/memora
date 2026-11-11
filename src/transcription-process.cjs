// Only signal the isolated process group created for this transcription.
// A leader's close event does not prove that its descendants have exited.
function trackProcess(job, child, detached) {
  const state = { child, group: detached && Number.isInteger(child.pid) && child.pid > 1, pid: child.pid, closed: false };
  state.done = new Promise(resolve => {
    child.once('close', () => { state.closed = true; resolve(); });
    child.once('error', () => { if (!Number.isInteger(child.pid)) { state.closed = true; resolve(); } });
  });
  job.process = state; job.child = child;
  return state;
}
function stopProcess(job, graceMs = 5000) {
  if (job.termination) return job.termination;
  const state = job.process;
  if (!state) return Promise.resolve();
  // Defer signalling so synchronous test doubles cannot settle before assignment.
  job.termination = Promise.resolve().then(async () => {
    const signal = name => {
      try { state.group ? process.kill(-state.pid, name) : (!state.closed && state.child.kill(name)); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const alive = () => {
      if (!state.group) return !state.closed;
      try { process.kill(-state.pid, 0); return true; }
      catch (error) {
        if (error.code === 'ESRCH') return false;
        // Diagnostics only: a denied probe is never interpreted as process exit.
        console.error('Transcription process exit probe failed',JSON.stringify({code:error.code,pid:state.pid,owner:process.pid,closed:state.closed,exitCode:state.child.exitCode,signalCode:state.child.signalCode,node:process.versions.node,electron:process.versions.electron}));
        throw error;
      }
    };
    signal('SIGTERM');
    const deadline = Date.now() + graceMs;
    let killed = false;
    // macOS can report EPERM for signal 0 while our terminated leader is a
    // zombie awaiting Node's waitpid. First wait for close (with escalation),
    // then independently verify the whole group has disappeared.
    while (!state.closed || alive()) {
      if (!killed && Date.now() >= deadline) { signal('SIGKILL'); killed = true; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await state.done;
  });
  return job.termination;
}
module.exports = { trackProcess, stopProcess };
