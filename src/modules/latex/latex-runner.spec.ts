import { ConfigService } from '@nestjs/config';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LatexRunner } from './latex.service';

describe('isolated LaTeX runner', () => {
  function processDouble() {
    return Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: jest.fn(),
    });
  }
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  it('passes source only on stdin and enforces an isolated, limited container', async () => {
    const child = processDouble();
    const spawn = jest.spyOn(childProcess,'spawn').mockReturnValue(child as unknown as childProcess.ChildProcess);
    const runner = new LatexRunner(new ConfigService());
    const pending = runner.run('private source');
    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=10001:10001','--memory=512m','--pids-limit=32','--pull=never']));
    expect(args).not.toContain('private source'); expect(args).not.toContain('-v'); expect(args).not.toContain('--mount');
    expect(child.stdin.read().toString()).toBe('private source');
    child.stdout.emit('data',Buffer.from(JSON.stringify({success:true,log:'ok',pdf:Buffer.from('%PDF-1.4\n').toString('base64')})));
    child.emit('close',0); await expect(pending).resolves.toMatchObject({success:true});
  });
  it('kills both the client and its container when the wall-clock timeout expires', async () => {
    jest.useFakeTimers(); const child = processDouble(); const cleanup = processDouble();
    const spawn = jest.spyOn(childProcess,'spawn').mockReturnValueOnce(child as unknown as childProcess.ChildProcess).mockReturnValue(cleanup as unknown as childProcess.ChildProcess);
    const pending = new LatexRunner(new ConfigService()).run('loop');
    const assertion = expect(pending).rejects.toMatchObject({status:408});
    jest.advanceTimersByTime(25001); await assertion;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(spawn.mock.calls[1][1]).toEqual(['rm','-f',expect.stringMatching(/^weave-tex-/)]);
    cleanup.emit('close',0);
  });
});
