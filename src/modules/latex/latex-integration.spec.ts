import { ConfigService } from '@nestjs/config';
import { LatexRunner, prepareLatex } from './latex.service';

// Explicit opt-in: requires Docker and a locally built weave-latex:1 image.
const integration = process.env.LATEX_INTEGRATION === '1' ? it : it.skip;
integration('compiles Spanish, multicolumn physics, AMS math and booktabs with real pdfLaTeX', async () => {
  const source = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath,amssymb,geometry,multicol,booktabs,array}
\geometry{top=1.5cm,bottom=1.5cm,left=1.5cm,right=1.5cm}
\setlength{\parindent}{0pt}
\setlength{\columnsep}{18pt}
\begin{document}
\begin{center}{\LARGE\textbf{Formulario de Física II}}\\[4pt]{\small Electrostática y Capacidad}\end{center}
\hr
\vspace{0.2cm}
\begin{multicols*}{2}
\section*{Constantes y cuantización}
\begin{itemize}
\item Carga elemental: $e=1.6021\times10^{-19}\text{ C}$
\item Permitividad: $\varepsilon_0\approx8.85\text{ pF/m}$
\end{itemize}
\[\vec{F}_{12}=k\frac{q_1q_2}{r_{12}^2}\hat{r}_{12}\]
\[\oint_S\vec{E}\cdot d\vec{A}=\frac{Q_{\text{enc}}}{\varepsilon_0}\]
\[\tau=pE\operatorname{sen}\theta\qquad n\in\mathbb{Z}\]
\subsection*{Condensadores}
\begin{tabular}{ll}\toprule Serie & Paralelo \\\midrule $1/C=\sum_i1/C_i$ & $C=\sum_iC_i$ \\\bottomrule\end{tabular}
\end{multicols*}
\end{document}`;
  const result = await new LatexRunner(new ConfigService()).run(prepareLatex(source));
  expect({success:result.success, log:result.success ? '' : result.log}).toEqual({success:true,log:''});
  expect(Buffer.from(result.pdf!, 'base64').subarray(0,5).toString()).toBe('%PDF-');
}, 30000);

integration('automatically compiles fontspec and installed OpenType fonts using XeLaTeX', async () => {
  const source = String.raw`\documentclass[11pt]{article}
\usepackage[margin=2cm]{geometry}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\setsansfont{Liberation Sans}
\usepackage[spanish]{babel}
\begin{document}
\section*{Corriente eléctrica}
Texto Unicode: á, é, í, ó, ú, ñ. {\sffamily Texto sans serif.}
\label{intro} Referencia: \ref{intro}.
\end{document}`;
  const result = await new LatexRunner(new ConfigService()).run(prepareLatex(source));
  expect({success:result.success, log:result.success ? '' : result.log}).toEqual({success:true,log:''});
  expect(result.log).toContain('Motor: xelatex');
  expect(Buffer.from(result.pdf!, 'base64').subarray(0,5).toString()).toBe('%PDF-');
}, 30000);

integration('compiles Babel Spanish imported once with onchar using LuaLaTeX in the read-only container', async () => {
  const source = String.raw`\documentclass[11pt]{article}
\usepackage[margin=2cm]{geometry}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\usepackage[spanish,bidi=basic,provide=*]{babel}
\babelprovide[onchar=ids fonts]{spanish}
\begin{document}
\section{Corriente eléctrica}\label{intro}
Texto Unicode: á, é, í, ó, ú, ñ. Referencia: \ref{intro}.
\end{document}`;
  const result = await new LatexRunner(new ConfigService()).run(prepareLatex(source));
  expect({success:result.success, log:result.success ? '' : result.log}).toEqual({success:true,log:''});
  expect(result.log).toContain('Motor: lualatex');
  expect(result.log).not.toMatch(/unrecognized option/i);
  expect(result.log).not.toContain('Rerun to get cross-references right');
  expect(Buffer.from(result.pdf!, 'base64').subarray(0,5).toString()).toBe('%PDF-');
}, 30000);

integration('compiles CircuiTikZ with siunitx both in full documents (including Spanish Babel) and block fragments', async () => {
  const runner = new LatexRunner(new ConfigService());
  const fullDocument = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage[siunitx]{circuitikz}
\begin{document}
\begin{circuitikz}[american]
  \draw (0,0) to[V, v=<5\volt>] (0,2.5)
        to[R, l=<10\kilo\ohm>, i>^=$i(t)$] (3,2.5)
        to[C, l=<100\micro\farad>] (3,0) -- (0,0);
\end{circuitikz}
\par Potencia disipada: \SI{2.5}{\milli\watt}.
\end{document}`;
  const docResult = await runner.run(prepareLatex(fullDocument, 'document'));
  expect({success:docResult.success, log:docResult.success ? '' : docResult.log}).toEqual({success:true,log:''});
  expect(docResult.log).toContain('Motor: pdflatex');
  expect(Buffer.from(docResult.pdf!, 'base64').subarray(0,5).toString()).toBe('%PDF-');

  const fragment = String.raw`\begin{circuitikz}[european]
  \draw (0,0) to[V, v=<12\volt>] (0,2) to[R, l=<4.7\kilo\ohm>] (3,2) -- (3,0) -- (0,0);
\end{circuitikz}`;
  const fragResult = await runner.run(prepareLatex(fragment, 'fragment'));
  expect({success:fragResult.success, log:fragResult.success ? '' : fragResult.log}).toEqual({success:true,log:''});
  expect(Buffer.from(fragResult.pdf!, 'base64').subarray(0,5).toString()).toBe('%PDF-');
}, 30000);
