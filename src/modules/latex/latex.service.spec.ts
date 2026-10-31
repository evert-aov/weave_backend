import { BadRequestException, HttpException } from '@nestjs/common';
import { validate } from 'class-validator';
import { CompileLatexDto } from './latex.dto';
import { LatexRunner, LatexService, prepareLatex } from './latex.service';

describe('LaTeX compilation boundary', () => {
  it('preserves full source and line numbers, adding the hr compatibility definition', () => {
    const source = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb,geometry,multicol,booktabs,array}
\begin{document}
\hr
\begin{multicols*}{2}
\section*{Física II} $\frac{q}{r^2}$
\end{multicols*}
\end{document}`;
    const output = prepareLatex(source);
    expect(output.endsWith(source)).toBe(true); expect(output.split('\n').length).toBe(source.split('\n').length);
    expect(output).toContain('\\providecommand{\\hr}');
    expect(output.startsWith('\\AtBeginDocument{')).toBe(true); // Respect preamble definitions of hr.
    expect(prepareLatex(source,'fragment')).toBe(output);
  });
  it('wraps block fragments in a preamble with the supported packages', () => {
    const source = '\\section*{Prueba}\nTexto $x^2$'; const wrapped = prepareLatex(source,'fragment');
    expect(wrapped).toContain('\\usepackage{amsmath,amssymb,geometry,multicol,booktabs,array}');
    expect(wrapped).toContain('\\usepackage[siunitx]{circuitikz}');
    expect(wrapped).toContain('\\begin{document}\n'+source); expect(wrapped.endsWith('\\end{document}')).toBe(true);
  });
  it('supports circuit fragments with explicit package options without option clashes or preamble-in-body errors', () => {
    const source = '\\usepackage[european,siunitx]{circuitikz}\n\\begin{circuitikz}\n\\draw (0,0) to[R=<10\\ohm>] (2,0);\n\\end{circuitikz}';
    const wrapped = prepareLatex(source, 'fragment');
    expect(wrapped.indexOf('\\usepackage[european,siunitx]{circuitikz}')).toBeLessThan(wrapped.indexOf('\\begin{document}'));
    expect(wrapped).not.toContain('\\usepackage[siunitx]{circuitikz}');
    expect(wrapped).toContain('\\begin{document}\n\\begin{circuitikz}');
  });
  it('validates the source and mode contract', async () => {
    expect(() => prepareLatex(' ')).toThrow(BadRequestException);
    expect(() => prepareLatex('x'.repeat(300001))).toThrow(BadRequestException);
    const dto = Object.assign(new CompileLatexDto(),{source:'x',mode:'shell'}); expect((await validate(dto)).length).toBe(1);
  });
  it('limits concurrency per user and globally, releasing capacity on failure', async () => {
    const resolvers: ((result: any) => void)[] = [];
    const runner = {run: jest.fn(() => new Promise(resolve => resolvers.push(resolve)))};
    const service = new LatexService(runner as unknown as LatexRunner);
    const one = service.compile('one',{source:'x'}); const two = service.compile('two',{source:'x'});
    await expect(service.compile('one',{source:'x'})).rejects.toBeInstanceOf(HttpException);
    await expect(service.compile('three',{source:'x'})).rejects.toMatchObject({status:429});
    resolvers.forEach(resolve => resolve({success:false,log:'syntax error'})); await Promise.all([one,two]);
    runner.run.mockRejectedValueOnce(new Error('runner failed') as never);
    await expect(service.compile('one',{source:'x'})).rejects.toThrow('runner failed');
    const retry = service.compile('one',{source:'x'}); resolvers.at(-1)!({success:true,log:'ok',pdf:'data'}); await expect(retry).resolves.toMatchObject({success:true});
  });
});
