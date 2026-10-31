FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 texlive-latex-base texlive-latex-recommended texlive-latex-extra \
    texlive-pictures texlive-science \
    texlive-lang-spanish texlive-fonts-recommended texlive-xetex texlive-luatex \
    fontconfig lmodern fonts-dejavu-core fonts-liberation2 fonts-texgyre fonts-texgyre-math \
    && fc-cache -f && rm -rf /var/lib/apt/lists/*
# Warm the Lua font index and common fonts once, not on every isolated request.
COPY lua-warmup.tex /opt/lua-warmup.tex
RUN mkdir -p /opt/latex-font-cache /tmp/lua-warmup \
    && TEXMFCACHE=/opt/latex-font-cache luaotfload-tool --update \
    && TEXMFCACHE=/opt/latex-font-cache lualatex -no-shell-escape -fmt=lualatex \
       -interaction=nonstopmode -halt-on-error -file-line-error \
       -output-directory=/tmp/lua-warmup /opt/lua-warmup.tex \
    && chmod -R a+rX /opt/latex-font-cache \
    && rm -rf /tmp/lua-warmup
COPY compile.py /opt/compile.py
ENV HOME=/tmp TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config \
    TEXMFCACHE=/work/.tex-cache \
    openout_any=p openin_any=p shell_escape=f
WORKDIR /work
USER 10001:10001
ENTRYPOINT ["python3", "-I", "/opt/compile.py"]
