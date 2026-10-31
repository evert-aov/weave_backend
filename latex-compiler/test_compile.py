"""Unit tests mock engine execution; they never run user TeX on the host."""
import base64
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("weave_compiler", Path(__file__).with_name("compile.py"))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class EngineSelectionTests(unittest.TestCase):
    def test_unicode_packages_and_font_commands_choose_xelatex(self):
        for source in (
            r"\usepackage{fontspec}",
            "\\usepackage [no-math]\n{amsmath, fontspec}",
            r"\RequirePackage{polyglossia}",
            r"\usepackage{unicode-math}",
            r"\setmainfont{TeX Gyre Termes}",
            r"\newfontfamily\headingfont{Liberation Sans}",
        ):
            with self.subTest(source=source):
                self.assertEqual(compiler.select_engine(source), "xelatex")

    def test_lua_requirements_take_priority_over_fontspec(self):
        for source in (
            r"\usepackage{fontspec}\usepackage[spanish,bidi=basic]{babel}",
            r"\usepackage[bidi = {basic-r}, spanish]{babel}\usepackage{fontspec}",
            "\\usepackage[bidi= % comment\nbasic,spanish]{babel}",
            r"\PassOptionsToPackage{bidi=basic}{babel}\usepackage{fontspec}",
            r"\documentclass[bidi=basic]{article}\usepackage{babel}",
            r"\usepackage{luacode}",
            r"\directlua{tex.print('Hello')}",
        ):
            with self.subTest(source=source):
                self.assertEqual(compiler.select_engine(source), "lualatex")

    def test_does_not_treat_ordinary_babel_or_commented_lua_options_as_lua_requirements(self):
        for source in (
            r"\usepackage[spanish]{babel}",
            "% \\usepackage[bidi=basic]{babel}\n\\usepackage{amsmath}",
            r"\begin{verbatim}\usepackage[bidi=basic]{babel}\end{verbatim}",
            r"\usepackage[bidi=basic-other]{babel}",
            r"\usepackage[bidi=basic]{different-package}",
        ):
            with self.subTest(source=source):
                self.assertEqual(compiler.select_engine(source), "pdflatex")
        self.assertEqual(compiler.select_engine(r"\usepackage{fontspec}\usepackage[bidi=bidi-r]{babel}"), "xelatex")

    def test_standard_documents_comments_and_examples_still_use_pdflatex(self):
        for source in (
            r"\documentclass{article}\usepackage{amsmath,babel}",
            "% \\usepackage{fontspec}\n\\usepackage{amsmath}",
            r"\begin{verbatim}\usepackage{fontspec}\end{verbatim}",
            r"\\% \usepackage{fontspec}",
        ):
            with self.subTest(source=source):
                self.assertEqual(compiler.select_engine(source), "pdflatex")
        self.assertEqual(compiler.select_engine(r"\% not a comment \usepackage{fontspec}"), "xelatex")


class CompileTests(unittest.TestCase):
    def setUp(self):
        self.previous = Path.cwd()
        self.directory = tempfile.TemporaryDirectory()
        os.chdir(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(os.chdir, self.previous)

    @staticmethod
    def success(args, **kwargs):
        kwargs["stdout"].write(b"Output written on main.pdf")
        Path("main.pdf").write_bytes(b"%PDF-1.4\nexample")
        return subprocess.CompletedProcess(args, 0)

    def test_two_passes_of_selected_engine_keep_source_and_isolation_flags(self):
        for engine, source in (("pdflatex", b"\\documentclass{article}"), ("xelatex", b"\\usepackage{fontspec}"), ("lualatex", b"\\usepackage[spanish,bidi=basic]{babel}")):
            with self.subTest(engine=engine), patch.object(compiler.subprocess, "run", side_effect=self.success) as run:
                result = compiler.compile_source(source)
                self.assertTrue(result["success"])
                self.assertTrue(base64.b64decode(result["pdf"]).startswith(b"%PDF-"))
                self.assertIn(f"Motor: {engine}", result["log"])
                self.assertEqual(Path("main.tex").read_bytes(), source)
                self.assertEqual(run.call_count, 2)
                for args, kwargs in run.call_args_list:
                    self.assertEqual(args[0][0], engine)
                    self.assertIn("-no-shell-escape", args[0])
                    if engine == "lualatex":
                        self.assertNotIn("-no-parse-first-line", args[0])
                        self.assertIn("-fmt=lualatex", args[0])
                    else:
                        self.assertIn("-no-parse-first-line", args[0])
                    self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
                    self.assertFalse(kwargs.get("shell", False))
                    self.assertLessEqual(kwargs["timeout"], 10)

    def test_indirect_fontspec_load_retries_with_xelatex_and_cleans_auxiliary_files(self):
        engines = []
        def run(args, **kwargs):
            engines.append(args[0])
            if args[0] == "pdflatex":
                Path("main.aux").write_text("old engine")
                kwargs["stdout"].write(b"Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec) LuaTeX.")
                return subprocess.CompletedProcess(args, 1)
            self.assertFalse(Path("main.aux").exists())
            return self.success(args, **kwargs)
        with patch.object(compiler.subprocess, "run", side_effect=run):
            result = compiler.compile_source(b"\\documentclass{custom}")
        self.assertTrue(result["success"])
        self.assertEqual(engines, ["pdflatex", "xelatex", "xelatex"])
        self.assertIn("seleccionado tras detectar", result["log"])

    def test_reported_babel_error_falls_back_from_xelatex_to_lualatex(self):
        engines = []
        diagnostic = """/usr/share/texlive/texmf-dist/tex/generic/babel/babel.sty:4083: Package babel E
rror: The bidi method 'basic' is available only in
(babel)                luatex. I'll continue with 'bidi=default', so
(babel)                expect wrong results."""
        def run(args, **kwargs):
            engines.append(args[0])
            if args[0] == "xelatex":
                kwargs["stdout"].write(diagnostic.encode())
                return subprocess.CompletedProcess(args, 1)
            self.assertTrue(Path(".tex-cache").is_dir())
            return self.success(args, **kwargs)
        with patch.object(compiler.subprocess, "run", side_effect=run):
            result = compiler.compile_source(b"\\usepackage{fontspec}\\input{class-with-babel}")
        self.assertTrue(result["success"])
        self.assertEqual(engines, ["xelatex", "lualatex", "lualatex"])
        self.assertIn("Motor: lualatex", result["log"])
        self.assertIn("Babel que requiere LuaTeX", result["log"])

    def test_engine_transitions_are_bounded_even_when_errors_keep_requesting_another_engine(self):
        engines = []
        def run(args, **kwargs):
            engines.append(args[0])
            message = "fontspec package requires either XeTeX or LuaTeX." if args[0] == "pdflatex" else "Package babel Error: The bidi method 'basic' is available only in (babel) luatex."
            kwargs["stdout"].write(message.encode())
            return subprocess.CompletedProcess(args, 1)
        with patch.object(compiler.subprocess, "run", side_effect=run):
            result = compiler.compile_source(b"\\documentclass{custom}")
        self.assertFalse(result["success"])
        self.assertEqual(engines, ["pdflatex", "xelatex", "lualatex"])

    def test_copies_font_cache_to_a_private_writable_location(self):
        seed = Path("seed"); (seed / "luatex-cache").mkdir(parents=True)
        (seed / "luatex-cache/index.lua").write_text("trusted index")
        with patch.object(compiler, "FONT_CACHE_SEED", seed):
            compiler.prepare_lua_cache()
            private = Path(".tex-cache/luatex-cache/index.lua")
            self.assertEqual(private.read_text(), "trusted index")
            private.write_text("per-request lookup")
            compiler.prepare_lua_cache()
            self.assertEqual(private.read_text(), "per-request lookup")
            self.assertEqual((seed / "luatex-cache/index.lua").read_text(), "trusted index")

    def test_duplicate_spanish_import_reports_hint_without_rewriting_or_retrying(self):
        source = b"\\usepackage[spanish,bidi=basic,provide=*]{babel}\n\\babelprovide[import,onchar=ids fonts]{spanish}"
        error = "./main.tex:5: LaTeX Error: Command \\spanishdate  already defined."
        def run(args, **kwargs):
            kwargs["stdout"].write(error.encode())
            return subprocess.CompletedProcess(args, 1)
        with patch.object(compiler.subprocess, "run", side_effect=run) as run:
            result = compiler.compile_source(source)
        self.assertFalse(result["success"])
        self.assertEqual(run.call_count, 1)
        self.assertEqual(Path("main.tex").read_bytes(), source)
        self.assertIn("Babel está redefiniendo español", result["log"])
        self.assertIn(error, result["log"])
        self.assertNotIn("pdf", result)

    def test_missing_circuit_or_science_package_reports_rebuild_hint(self):
        source = b"\\documentclass{article}\n\\usepackage[siunitx]{circuitikz}\n\\begin{document}x\\end{document}"
        error = "! LaTeX Error: File `siunitx.sty' not found."
        def run(args, **kwargs):
            kwargs["stdout"].write(error.encode())
            return subprocess.CompletedProcess(args, 1)
        with patch.object(compiler.subprocess, "run", side_effect=run) as run:
            result = compiler.compile_source(source)
        self.assertFalse(result["success"])
        self.assertEqual(run.call_count, 1)
        self.assertIn("docker build -t weave-latex:1 ./latex-compiler", result["log"])
        self.assertIn(error, result["log"])

    def test_plain_syntax_error_does_not_retry_another_engine(self):
        def run(args, **kwargs):
            kwargs["stdout"].write(b"main.tex:9: Undefined control sequence.")
            return subprocess.CompletedProcess(args, 1)
        with patch.object(compiler.subprocess, "run", side_effect=run) as run:
            result = compiler.compile_source(b"\\invalid")
        self.assertFalse(result["success"])
        self.assertIn("main.tex:9", result["log"])
        self.assertEqual(run.call_count, 1)

    def test_total_deadline_limits_later_passes(self):
        with patch.object(compiler.time, "monotonic", side_effect=[100, 100, 115]), patch.object(compiler.subprocess, "run", side_effect=self.success) as run:
            self.assertTrue(compiler.compile_source(b"test")["success"])
        self.assertEqual([call.kwargs["timeout"] for call in run.call_args_list], [10, 5])

    def test_timeout_and_missing_engine_report_actionable_errors(self):
        for error in (subprocess.TimeoutExpired("xelatex", 10), FileNotFoundError()):
            with self.subTest(error=error), patch.object(compiler.subprocess, "run", side_effect=error):
                result = compiler.compile_source(b"\\usepackage{fontspec}")
            self.assertFalse(result["success"])
            self.assertNotIn("pdf", result)
            self.assertIn("Motor: xelatex", result["log"])
            self.assertIn("tiempo permitido" if isinstance(error, subprocess.TimeoutExpired) else "Reconstruye", result["log"])

    def test_bounded_source_and_log(self):
        with patch.object(compiler.subprocess, "run") as run:
            self.assertFalse(compiler.compile_source(b"x" * (compiler.SOURCE_LIMIT + 1))["success"])
            run.assert_not_called()
        def run(args, **kwargs):
            kwargs["stdout"].write(("ó" * 20000).encode())
            return subprocess.CompletedProcess(args, 1)
        with patch.object(compiler.subprocess, "run", side_effect=run):
            result = compiler.compile_source(b"test")
        self.assertLessEqual(len(result["log"].encode()), compiler.LOG_LIMIT)


if __name__ == "__main__":
    unittest.main()
