import { BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CompileLatexDto } from './latex.dto';

export interface LatexResult { pdf?: string; log: string; success: boolean }

/** Runs untrusted TeX in a disposable container, never in the Nest host. */
@Injectable()
export class LatexRunner {
  constructor(private readonly config: ConfigService) {}

  run(source: string): Promise<LatexResult> {
    const name = `weave-tex-${randomUUID()}`;
    const image = this.config.get<string>('LATEX_DOCKER_IMAGE') || 'weave-latex:1';
    const args = ['run', '--rm', '-i', '--pull=never', '--name', name,
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--user=10001:10001', '--pids-limit=32', '--memory=512m', '--memory-swap=512m', '--cpus=1',
      '--ulimit=fsize=33554432:33554432', '--tmpfs=/work:rw,noexec,nosuid,size=64m,mode=1777',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777', image];
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = []; let bytes = 0; let settled = false;
      const unavailable = () => new ServiceUnavailableException('Compilador LaTeX no disponible. Construye la imagen weave-latex:1 y habilita Docker para el backend.');
      const cleanup = () => {
        const removal = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
        removal.on('error', () => undefined);
        const cleanupTimer = setTimeout(() => removal.kill('SIGKILL'), 5000);
        cleanupTimer.unref(); removal.on('close', () => clearTimeout(cleanupTimer));
      };
      const fail = (error: Error) => {
        if (settled) return; settled = true; clearTimeout(timer);
        child.kill('SIGKILL'); cleanup(); reject(error);
      };
      const timer = setTimeout(() => fail(new HttpException('La compilación superó el límite de 25 segundos.', 408)), 25_000);
      child.on('error', () => fail(unavailable()));
      child.stdin.on('error', () => undefined); // Early container exit (missing image/daemon).
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 24 * 1024 * 1024) fail(new BadRequestException('La salida LaTeX supera el límite permitido.'));
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on('close', code => {
        if (settled) return;
        clearTimeout(timer); settled = true;
        if (code !== 0) { cleanup(); reject(unavailable()); return; }
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString()) as LatexResult;
          if (typeof result.success !== 'boolean' || typeof result.log !== 'string') throw new Error('Invalid result');
          if (result.success && (typeof result.pdf !== 'string' || !Buffer.from(result.pdf, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error('Invalid PDF');
          resolve(result);
        } catch { reject(unavailable()); }
      });
      child.stdin.end(source, 'utf8');
    });
  }
}

const FRAGMENT_PREAMBLE_LINE = /^\s*(?:%.*|\\(?:usepackage|RequirePackage|PassOptionsToPackage|usetikzlibrary|ctikzset|sisetup|pgfplotsset|geometry|setlength)\b.*)?$/;

function stripLatexComments(source: string): string {
  return source.replace(/\\.|%[^\n]*/g, match => match.startsWith('%') ? '' : match);
}

export function prepareLatex(source: string, mode: 'document' | 'fragment' = 'document'): string {
  if (!source.trim() || source.length > 300_000) throw new BadRequestException('Escribe LaTeX (máximo 300 000 caracteres).');
  // Same-line prefix preserves compiler line numbers for full documents and harmonizes TikZ/CircuiTikZ with Babel shorthands.
  const compatibility = String.raw`\AtBeginDocument{\providecommand{\hr}{\par\noindent\rule{\linewidth}{0.4pt}\par}}\AddToHook{begindocument/before}{\csname @ifpackageloaded\endcsname{tikz}{\csname @ifpackageloaded\endcsname{babel}{\usetikzlibrary{babel}}{}}{}}`;
  const active = stripLatexComments(source);
  if (mode === 'fragment' && !/^\s*\\documentclass\b/m.test(active)) {
    const loadsPackage = (pattern: string) => new RegExp(`\\\\(?:usepackage|RequirePackage)\\s*(?:\\[[^\\]]*\\]\\s*)?\\{[^}]*\\b(?:${pattern})\\b[^}]*\\}`).test(active);
    const inputencLine = loadsPackage('fontspec|unicode-math|polyglossia|inputenc') ? '%' : String.raw`\usepackage[utf8]{inputenc}`;
    const babelLine = loadsPackage('babel|polyglossia') ? '%' : String.raw`\usepackage[spanish]{babel}`;
    const circuitExtra = loadsPackage('circuitikz') ? '' : String.raw`\usepackage[siunitx]{circuitikz}`;
    const basePreamble = `${compatibility}\\documentclass[10pt,a4paper]{article}\n${inputencLine}\n${babelLine}\n` +
      String.raw`\usepackage{amsmath,amssymb,geometry,multicol,booktabs,array}` + '\n' +
      String.raw`\geometry{margin=1.5cm}` + circuitExtra;
    if (/\\begin\{document\}/.test(active)) {
      return `${basePreamble}\n${source}`;
    }
    if (/^\s*\\(?:usepackage|RequirePackage)\b/m.test(active)) {
      const lines = source.split('\n');
      let splitAt = 0;
      while (splitAt < lines.length && FRAGMENT_PREAMBLE_LINE.test(lines[splitAt])) splitAt++;
      return `${basePreamble}\n${lines.slice(0, splitAt).join('\n')}\n\\begin{document}\n${lines.slice(splitAt).join('\n')}\n\\end{document}`;
    }
    return `${basePreamble}\n\\begin{document}\n${source}\n\\end{document}`;
  }
  return compatibility + source;
}

@Injectable()
export class LatexService {
  private readonly activeUsers = new Set<string>();
  constructor(private readonly runner: LatexRunner) {}
  async compile(userId: string, dto: CompileLatexDto): Promise<LatexResult> {
    const source = prepareLatex(dto.source, dto.mode);
    if (this.activeUsers.has(userId) || this.activeUsers.size >= 2) throw new HttpException('El compilador está ocupado. Inténtalo de nuevo en unos segundos.', 429);
    this.activeUsers.add(userId);
    try { return await this.runner.run(source); }
    finally { this.activeUsers.delete(userId); }
  }
}
